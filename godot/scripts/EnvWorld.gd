extends Node2D

const CHUNK_SIZE: float = 8192.0
const VIEW_RADIUS: int = 1 # radius 1 around camera (3x3 grid)
const UNLOAD_RADIUS: int = 2 # radius 2: chunks beyond this are freed
const MAX_CONCURRENT_TASKS: int = 2 # at most 2 worker tasks parsing at once

var chunk_size: float = 8192.0
var existing_keys: Dictionary = {} # String -> true
var active_chunks: Dictionary = {} # String -> EnvChunk
var loading_tasks: Dictionary = {} # String -> int (task_id)
var pending_results: Dictionary = {} # String -> Dictionary (mutex-protected)
var ready_queue: Array = [] # Array of Dictionary { "key": String, "data": Dictionary }
var truck_ref: Node2D = null

var last_chunk_build_ms: float = 0.0

var _mutex: Mutex = Mutex.new()
var _is_exiting: bool = false

# Sorting priority for land types:
# Поля/луга -> Жилые/пром/кладбища -> Леса/сады/виноградники -> Водоёмы
const LAND_PRIORITY: Dictionary = {
	0: 10, # farmland (поля)
	3: 11, # meadow (луга)
	5: 20, # residential (жилые)
	6: 21, # industrial (пром)
	7: 22, # commercial
	8: 23, # retail
	9: 24, # cemetery (кладбища)
	1: 30, # vineyard (виноградники)
	2: 31, # orchard (сады)
	4: 32, # forest (леса)
	10: 33, # wood (леса)
	12: 34, # scrub (кустарники)
	11: 40, # water (водоёмы)
}

const LAND_COLORS: Dictionary = {
	0: Color(0.165, 0.200, 0.145, 1.0), # farmland (#2a3325)
	1: Color(0.173, 0.216, 0.145, 1.0), # vineyard (#2c3725)
	2: Color(0.169, 0.216, 0.141, 1.0), # orchard (#2b3724)
	3: Color(0.153, 0.192, 0.137, 1.0), # meadow (#273123)
	4: Color(0.110, 0.145, 0.094, 1.0), # forest (#1c2518)
	5: Color(0.169, 0.173, 0.157, 1.0), # residential (#2b2c28)
	6: Color(0.184, 0.188, 0.180, 1.0), # industrial (#2f302e)
	7: Color(0.188, 0.192, 0.184, 1.0), # commercial (#30312f)
	8: Color(0.192, 0.196, 0.188, 1.0), # retail (#313230)
	9: Color(0.133, 0.153, 0.125, 1.0), # cemetery (#222720)
	10: Color(0.106, 0.141, 0.090, 1.0), # wood (#1b2417)
	11: Color(0.102, 0.149, 0.188, 1.0), # water (#1a2630)
	12: Color(0.157, 0.196, 0.133, 1.0), # scrub (#283222)
}

# -------------------------------------------------------------
# Helper: Fast Mesh Builder for 2D Colored Triangles
# -------------------------------------------------------------
class MeshBuilder extends RefCounted:
	var vertices: PackedVector2Array = PackedVector2Array()
	var colors: PackedColorArray = PackedColorArray()
	var indices: PackedInt32Array = PackedInt32Array()

	func add_quad(v0: Vector2, v1: Vector2, v2: Vector2, v3: Vector2, col: Color) -> void:
		var base = vertices.size()
		vertices.append(v0)
		vertices.append(v1)
		vertices.append(v2)
		vertices.append(v3)
		colors.append(col)
		colors.append(col)
		colors.append(col)
		colors.append(col)
		# 2 triangles
		indices.append(base)
		indices.append(base + 1)
		indices.append(base + 2)
		indices.append(base)
		indices.append(base + 2)
		indices.append(base + 3)

	func add_thick_segment(p1: Vector2, p2: Vector2, half_w: float, col: Color) -> void:
		var d = p1.distance_to(p2)
		if d < 0.5:
			return
		var dir = (p2 - p1) / d
		var norm = Vector2(-dir.y, dir.x) * half_w
		add_quad(p1 - norm, p1 + norm, p2 + norm, p2 - norm, col)

	func add_polygon(pts: PackedVector2Array, tris: PackedInt32Array, col: Color) -> void:
		var base = vertices.size()
		var n = pts.size()
		for i in range(n):
			vertices.append(pts[i])
			colors.append(col)
		var num_tris = tris.size() / 3
		for t in range(num_tris):
			indices.append(base + tris[t * 3])
			indices.append(base + tris[t * 3 + 1])
			indices.append(base + tris[t * 3 + 2])

	func build_mesh() -> ArrayMesh:
		if vertices.is_empty() or indices.is_empty():
			return null
		var surface_array = []
		surface_array.resize(Mesh.ARRAY_MAX)
		surface_array[Mesh.ARRAY_VERTEX] = vertices
		surface_array[Mesh.ARRAY_COLOR] = colors
		surface_array[Mesh.ARRAY_INDEX] = indices

		var mesh = ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, surface_array)
		return mesh

# -------------------------------------------------------------
# EnvChunk: Single 8192-unit Chunk Node2D with 1 MeshInstance2D per layer
# -------------------------------------------------------------
class EnvChunk extends Node2D:
	func set_chunk_meshes(land_m: Mesh, water_m: Mesh, rail_m: Mesh, bld_m: Mesh) -> void:
		if land_m:
			var mi = MeshInstance2D.new()
			mi.name = "Land"
			mi.mesh = land_m
			add_child(mi)
		if water_m:
			var mi = MeshInstance2D.new()
			mi.name = "Water"
			mi.mesh = water_m
			add_child(mi)
		if rail_m:
			var mi = MeshInstance2D.new()
			mi.name = "Rail"
			mi.mesh = rail_m
			add_child(mi)
		if bld_m:
			var mi = MeshInstance2D.new()
			mi.name = "Buildings"
			mi.mesh = bld_m
			add_child(mi)

# -------------------------------------------------------------
# EnvWorld Lifecycle & Streaming
# -------------------------------------------------------------
func _ready() -> void:
	z_index = -10
	load_env_index("res://data/env-index.json")

func _exit_tree() -> void:
	_is_exiting = true
	for task_id in loading_tasks.values():
		WorkerThreadPool.wait_for_task_completion(task_id)
	loading_tasks.clear()

func load_env_index(path: String) -> void:
	if not FileAccess.file_exists(path):
		push_error("[EnvWorld] env-index.json not found: " + path)
		return

	var file = FileAccess.open(path, FileAccess.READ)
	if not file:
		push_error("[EnvWorld] Failed to open: " + path)
		return

	var json_text = file.get_as_text()
	var json = JSON.new()
	if json.parse(json_text) != OK:
		push_error("[EnvWorld] JSON parse error: " + json.get_error_message())
		return

	var data = json.data
	if not data is Dictionary:
		push_error("[EnvWorld] env-index.json is not a Dictionary")
		return

	chunk_size = float(data.get("chunkSize", 8192.0))
	var chunks_list = data.get("chunks", [])
	for k in chunks_list:
		existing_keys[str(k)] = true

	print("[EnvWorld] Loaded index with %d environment chunks (chunkSize: %.0f)." % [existing_keys.size(), chunk_size])

func _process(_delta: float) -> void:
	# 1. Collect completed worker tasks
	_check_worker_tasks()

	# 2. Spawn at most 1 new chunk per frame
	_spawn_pending_chunk()

	# 3. Determine camera position
	var cam_pos: Vector2 = Vector2.ZERO
	if truck_ref and is_instance_valid(truck_ref):
		cam_pos = truck_ref.global_position
	else:
		var cam = get_viewport().get_camera_2d()
		if cam:
			cam_pos = cam.global_position

	# Check zoom level: hide environment at high distance zoom out
	var cam = get_viewport().get_camera_2d()
	if cam:
		var zoomed_out = cam.zoom.x < 0.35
		if visible == zoomed_out:
			visible = not zoomed_out

	var center_cx: int = int(floor(cam_pos.x / chunk_size))
	var center_cy: int = int(floor(cam_pos.y / chunk_size))

	# 4. Unload chunks beyond UNLOAD_RADIUS
	_unload_distant_chunks(center_cx, center_cy)

	# 5. Request chunks in VIEW_RADIUS around camera
	_request_visible_chunks(center_cx, center_cy)

func _check_worker_tasks() -> void:
	var finished: Array = []
	for k in loading_tasks.keys():
		var task_id = loading_tasks[k]
		if WorkerThreadPool.is_task_completed(task_id):
			WorkerThreadPool.wait_for_task_completion(task_id)
			finished.append(k)

	for k in finished:
		loading_tasks.erase(k)
		_mutex.lock()
		var res = pending_results.get(k, null)
		pending_results.erase(k)
		_mutex.unlock()

		if res and not res.is_empty():
			if "build_ms" in res:
				last_chunk_build_ms = res["build_ms"]
			ready_queue.append({ "key": k, "data": res })

func _spawn_pending_chunk() -> void:
	var cam_pos: Vector2 = Vector2.ZERO
	if truck_ref and is_instance_valid(truck_ref):
		cam_pos = truck_ref.global_position
	var center_cx: int = int(floor(cam_pos.x / chunk_size))
	var center_cy: int = int(floor(cam_pos.y / chunk_size))

	while not ready_queue.is_empty():
		var item = ready_queue.pop_front()
		var k: String = item["key"]
		var coords = _parse_key(k)
		if abs(coords.x - center_cx) <= UNLOAD_RADIUS and abs(coords.y - center_cy) <= UNLOAD_RADIUS:
			if not active_chunks.has(k):
				var data = item["data"]
				var chunk_node = EnvChunk.new()
				chunk_node.name = "EnvChunk_" + k
				chunk_node.set_chunk_meshes(
					data.get("land_mesh", null),
					data.get("water_mesh", null),
					data.get("rail_mesh", null),
					data.get("buildings_mesh", null)
				)
				add_child(chunk_node)
				active_chunks[k] = chunk_node
				break # At most 1 chunk instantiated per frame!

func _unload_distant_chunks(center_cx: int, center_cy: int) -> void:
	var to_remove: Array = []
	for k in active_chunks.keys():
		var coords = _parse_key(k)
		if abs(coords.x - center_cx) > UNLOAD_RADIUS or abs(coords.y - center_cy) > UNLOAD_RADIUS:
			var node = active_chunks[k]
			if is_instance_valid(node):
				node.queue_free()
			to_remove.append(k)

	for k in to_remove:
		active_chunks.erase(k)

func _request_visible_chunks(center_cx: int, center_cy: int) -> void:
	if loading_tasks.size() >= MAX_CONCURRENT_TASKS:
		return

	for dx in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
		for dy in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
			if loading_tasks.size() >= MAX_CONCURRENT_TASKS:
				return
			var k = "%d_%d" % [center_cx + dx, center_cy + dy]
			if not existing_keys.has(k):
				continue
			if active_chunks.has(k) or loading_tasks.has(k) or _is_in_ready_queue(k):
				continue

			var file_path = "res://data/env-tiles/%s.json" % k
			if not FileAccess.file_exists(file_path):
				continue

			var task_id = WorkerThreadPool.add_task(_worker_load_chunk.bind(k, file_path))
			loading_tasks[k] = task_id

func _is_in_ready_queue(key: String) -> bool:
	for item in ready_queue:
		if item["key"] == key:
			return true
	return false

func _parse_key(key: String) -> Vector2i:
	var parts = key.split("_")
	if parts.size() >= 2:
		return Vector2i(int(parts[0]), int(parts[1]))
	return Vector2i.ZERO

# -------------------------------------------------------------
# Background Worker Task: Read file, parse JSON, build 4 Layer Meshes
# -------------------------------------------------------------
func _worker_load_chunk(key: String, file_path: String) -> void:
	var t_start = Time.get_ticks_usec()
	var coords = _parse_key(key)
	var cx: int = coords.x
	var cy: int = coords.y

	var result: Dictionary = {}
	if not FileAccess.file_exists(file_path):
		_store_worker_result(key, result)
		return

	var file = FileAccess.open(file_path, FileAccess.READ)
	if not file:
		_store_worker_result(key, result)
		return

	var json_text = file.get_as_text()
	var json = JSON.new()
	if json.parse(json_text) != OK:
		_store_worker_result(key, result)
		return

	var data = json.data
	if not data is Dictionary:
		_store_worker_result(key, result)
		return

	# 1. Background + Land Mesh
	var land_builder = MeshBuilder.new()
	var ox: float = float(cx) * CHUNK_SIZE
	var oy: float = float(cy) * CHUNK_SIZE
	land_builder.add_quad(
		Vector2(ox, oy),
		Vector2(ox + CHUNK_SIZE, oy),
		Vector2(ox + CHUNK_SIZE, oy + CHUNK_SIZE),
		Vector2(ox, oy + CHUNK_SIZE),
		Color(0.145, 0.173, 0.133, 1.0) # #252c22 background
	)

	var raw_land = data.get("land", [])
	raw_land.sort_custom(func(a, b):
		var pA = LAND_PRIORITY.get(int(a[0]), 99)
		var pB = LAND_PRIORITY.get(int(b[0]), 99)
		return pA < pB
	)

	for entry in raw_land:
		if entry.size() < 2:
			continue
		var type_code: int = int(entry[0])
		var flat: Array = entry[1]
		var n: int = flat.size() / 2
		if n < 3:
			continue

		# Bounding box filter for small degenerate polygons
		var min_x: float = INF
		var max_x: float = -INF
		var min_y: float = INF
		var max_y: float = -INF
		var pts: PackedVector2Array = PackedVector2Array()
		pts.resize(n)
		for i in range(n):
			var px = float(flat[i * 2])
			var py = float(flat[i * 2 + 1])
			pts[i] = Vector2(px, py)
			if px < min_x: min_x = px
			if px > max_x: max_x = px
			if py < min_y: min_y = py
			if py > max_y: max_y = py

		if (max_x - min_x) * (max_y - min_y) < 150.0:
			continue # Skip micro-slivers

		var tris = Geometry2D.triangulate_polygon(pts)
		if tris.is_empty():
			continue

		var col = LAND_COLORS.get(type_code, Color(0.145, 0.173, 0.133, 1.0))
		land_builder.add_polygon(pts, tris, col)

	result["land_mesh"] = land_builder.build_mesh()

	# 2. Water Mesh (thick 7.0 px quads)
	var water_builder = MeshBuilder.new()
	var raw_water = data.get("water", [])
	var water_col = Color(0.106, 0.157, 0.200, 1.0) # #1b2833
	for flat in raw_water:
		var n: int = flat.size() / 2
		if n < 2:
			continue
		for i in range(n - 1):
			var p1 = Vector2(float(flat[i * 2]), float(flat[i * 2 + 1]))
			var p2 = Vector2(float(flat[(i + 1) * 2]), float(flat[(i + 1) * 2 + 1]))
			water_builder.add_thick_segment(p1, p2, 3.5, water_col)

	result["water_mesh"] = water_builder.build_mesh()

	# 3. Rail Mesh (lines + sleepers as quads)
	var rail_builder = MeshBuilder.new()
	var raw_rail = data.get("rail", [])
	var rail_col = Color(0.32, 0.32, 0.34, 1.0)
	var sleeper_col = Color(0.20, 0.20, 0.22, 1.0)

	for flat in raw_rail:
		var n: int = flat.size() / 2
		if n < 2:
			continue
		for i in range(n - 1):
			var p1 = Vector2(float(flat[i * 2]), float(flat[i * 2 + 1]))
			var p2 = Vector2(float(flat[(i + 1) * 2]), float(flat[(i + 1) * 2 + 1]))
			rail_builder.add_thick_segment(p1, p2, 1.25, rail_col)

			var d = p1.distance_to(p2)
			if d < 1.0:
				continue
			var dir = (p2 - p1) / d
			var norm = Vector2(-dir.y, dir.x) * 5.0
			var s: float = 0.0
			while s <= d:
				var mid = p1 + dir * s
				rail_builder.add_thick_segment(mid - norm, mid + norm, 1.0, sleeper_col)
				s += 16.0

	result["rail_mesh"] = rail_builder.build_mesh()

	# 4. Buildings Mesh (fills + 1px outlines as quads)
	var bld_builder = MeshBuilder.new()
	var raw_bld = data.get("buildings", [])
	var bld_fill = Color(0.235, 0.247, 0.255, 1.0)
	var bld_out = Color(0.160, 0.169, 0.176, 1.0)

	for b in raw_bld:
		if b.size() < 5:
			continue
		var bcx: float = float(b[0])
		var bcy: float = float(b[1])
		var bw: float = float(b[2])
		var bh: float = float(b[3])

		# Skip tiny buildings (< 180 area or min dim < 6)
		if bw * bh < 180.0 or bw < 6.0 or bh < 6.0:
			continue

		var angle: float = float(b[4])
		var hw: float = bw * 0.5
		var hh: float = bh * 0.5
		var cos_a: float = cos(angle)
		var sin_a: float = sin(angle)

		var p1 = Vector2(bcx - hw * cos_a + hh * sin_a, bcy - hw * sin_a - hh * cos_a)
		var p2 = Vector2(bcx + hw * cos_a + hh * sin_a, bcy + hw * sin_a - hh * cos_a)
		var p3 = Vector2(bcx + hw * cos_a - hh * sin_a, bcy + hw * sin_a + hh * cos_a)
		var p4 = Vector2(bcx - hw * cos_a - hh * sin_a, bcy - hw * sin_a + hh * cos_a)

		bld_builder.add_quad(p1, p2, p3, p4, bld_fill)

		# 1px outline
		bld_builder.add_thick_segment(p1, p2, 0.5, bld_out)
		bld_builder.add_thick_segment(p2, p3, 0.5, bld_out)
		bld_builder.add_thick_segment(p3, p4, 0.5, bld_out)
		bld_builder.add_thick_segment(p4, p1, 0.5, bld_out)

	result["buildings_mesh"] = bld_builder.build_mesh()

	result["build_ms"] = (Time.get_ticks_usec() - t_start) / 1000.0

	_store_worker_result(key, result)

func _store_worker_result(key: String, result: Dictionary) -> void:
	if _is_exiting:
		return
	_mutex.lock()
	pending_results[key] = result
	_mutex.unlock()
