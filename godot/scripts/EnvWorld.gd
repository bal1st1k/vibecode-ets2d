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

# Real main-thread build time in ms (resets each frame so HUD never sticks)
var last_chunk_build_ms: float = 0.0

var _mutex: Mutex = Mutex.new()
var _is_exiting: bool = false

# Staged chunk addition state (ensures main thread never exceeds 8ms per frame)
var _staged_key: String = ""
var _staged_node: EnvChunk = null
var _staged_data: Dictionary = {}
var _staged_layer: int = 0

# Distinct, readable topography palette
# Background earth / base ground
const BASE_GROUND_COLOR: Color = Color(0.20, 0.23, 0.17, 1.0) # #333b2b neutral olive earth

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
	0: Color(0.32, 0.38, 0.22, 1.0), # farmland (#526138 warm yellowish-green fields)
	1: Color(0.18, 0.32, 0.16, 1.0), # vineyard (#2e5229 lush green)
	2: Color(0.16, 0.30, 0.15, 1.0), # orchard (#294d26 green)
	3: Color(0.28, 0.36, 0.20, 1.0), # meadow (#475c33 fresh yellowish-green meadow)
	4: Color(0.08, 0.22, 0.10, 1.0), # forest (#14381a saturated dark green)
	5: Color(0.27, 0.28, 0.27, 1.0), # residential (#454745 urban grey)
	6: Color(0.24, 0.25, 0.26, 1.0), # industrial (#3d4042)
	7: Color(0.28, 0.29, 0.30, 1.0), # commercial (#474a4d)
	8: Color(0.29, 0.30, 0.31, 1.0), # retail (#4a4d4f)
	9: Color(0.16, 0.22, 0.16, 1.0), # cemetery (#293829)
	10: Color(0.08, 0.22, 0.10, 1.0), # wood (#14381a saturated dark green)
	11: Color(0.18, 0.45, 0.68, 1.0), # water (#2e73ad noticeably brighter blue)
	12: Color(0.26, 0.32, 0.18, 1.0), # scrub (#42522e olive shrub)
}

const WATER_COLOR: Color = Color(0.18, 0.45, 0.68, 1.0) # #2e73ad bright blue rivers/streams
const BLD_FILL_COLOR: Color = Color(0.55, 0.57, 0.60, 1.0) # #8c9199 light concrete rooftop
const BLD_OUTLINE_COLOR: Color = Color(0.18, 0.19, 0.20, 1.0) # #2e3033 thin dark contour

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
# EnvChunk: Single 8192-unit Chunk Node2D with LOD support
# -------------------------------------------------------------
class EnvChunk extends Node2D:
	var land_base_mi: MeshInstance2D = null
	var land_detail_mi: MeshInstance2D = null
	var water_mi: MeshInstance2D = null
	var rail_mi: MeshInstance2D = null
	var bld_mi: MeshInstance2D = null

	func update_lod(zoom: float) -> void:
		# LOD: When zoom < 0.6x, hide buildings and fine land details to prevent clutter and maintain high FPS
		var show_details: bool = zoom >= 0.6
		if bld_mi and bld_mi.visible != show_details:
			bld_mi.visible = show_details
		if land_detail_mi and land_detail_mi.visible != show_details:
			land_detail_mi.visible = show_details

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

	# 2. Spawn pending chunk with main-thread frame budget <= 8 ms
	_spawn_pending_chunk()

	# 3. Determine camera position & zoom
	var cam_pos: Vector2 = Vector2.ZERO
	if truck_ref and is_instance_valid(truck_ref):
		cam_pos = truck_ref.global_position
	else:
		var cam = get_viewport().get_camera_2d()
		if cam:
			cam_pos = cam.global_position

	var cam = get_viewport().get_camera_2d()
	var cur_zoom: float = cam.zoom.x if cam else 1.0

	# Keep environment always visible (do not hide on highway auto-zoom!)
	visible = true

	# Update LOD on active chunks based on zoom level
	for chunk in active_chunks.values():
		if is_instance_valid(chunk):
			chunk.update_lod(cur_zoom)

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
			ready_queue.append({ "key": k, "data": res })

func _spawn_pending_chunk() -> void:
	# Reset every frame so HUD never shows stuck values
	last_chunk_build_ms = 0.0

	var cam_pos: Vector2 = Vector2.ZERO
	if truck_ref and is_instance_valid(truck_ref):
		cam_pos = truck_ref.global_position
	else:
		var cam = get_viewport().get_camera_2d()
		if cam:
			cam_pos = cam.global_position

	var center_cx: int = int(floor(cam_pos.x / chunk_size))
	var center_cy: int = int(floor(cam_pos.y / chunk_size))

	# If currently finishing a multi-stage chunk:
	if _staged_node != null and is_instance_valid(_staged_node):
		var t0 = Time.get_ticks_usec()
		_process_staged_layers(t0)
		return

	if ready_queue.is_empty():
		return

	# Sort ready_queue by distance to center
	ready_queue.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var ca = _parse_key(a["key"])
		var cb = _parse_key(b["key"])
		var da = (ca.x - center_cx) * (ca.x - center_cx) + (ca.y - center_cy) * (ca.y - center_cy)
		var db = (cb.x - center_cx) * (cb.x - center_cx) + (cb.y - center_cy) * (cb.y - center_cy)
		return da < db
	)

	while not ready_queue.is_empty():
		var item = ready_queue.pop_front()
		var k: String = item["key"]
		var coords = _parse_key(k)
		if abs(coords.x - center_cx) <= UNLOAD_RADIUS and abs(coords.y - center_cy) <= UNLOAD_RADIUS:
			if not active_chunks.has(k):
				var t0 = Time.get_ticks_usec()
				_staged_key = k
				_staged_data = item["data"]
				_staged_node = EnvChunk.new()
				_staged_node.name = "EnvChunk_" + k
				add_child(_staged_node)
				_staged_layer = 0
				_process_staged_layers(t0)
				break

func _process_staged_layers(t0: int) -> void:
	var cam = get_viewport().get_camera_2d()
	var cur_zoom: float = cam.zoom.x if cam else 1.0

	while _staged_layer < 5:
		if _staged_layer == 0:
			var m = _staged_data.get("land_base_mesh", null)
			if m:
				var mi = MeshInstance2D.new()
				mi.name = "LandBase"
				mi.mesh = m
				_staged_node.add_child(mi)
				_staged_node.land_base_mi = mi
		elif _staged_layer == 1:
			var m = _staged_data.get("land_detail_mesh", null)
			if m:
				var mi = MeshInstance2D.new()
				mi.name = "LandDetail"
				mi.mesh = m
				_staged_node.add_child(mi)
				_staged_node.land_detail_mi = mi
		elif _staged_layer == 2:
			var m = _staged_data.get("water_mesh", null)
			if m:
				var mi = MeshInstance2D.new()
				mi.name = "Water"
				mi.mesh = m
				_staged_node.add_child(mi)
				_staged_node.water_mi = mi
		elif _staged_layer == 3:
			var m = _staged_data.get("rail_mesh", null)
			if m:
				var mi = MeshInstance2D.new()
				mi.name = "Rail"
				mi.mesh = m
				_staged_node.add_child(mi)
				_staged_node.rail_mi = mi
		elif _staged_layer == 4:
			var m = _staged_data.get("buildings_mesh", null)
			if m:
				var mi = MeshInstance2D.new()
				mi.name = "Buildings"
				mi.mesh = m
				_staged_node.add_child(mi)
				_staged_node.bld_mi = mi

		_staged_layer += 1

		# Time slice budget: if frame time exceeds 8 ms (8000 us), defer remaining layers to next frame
		var elapsed_us = Time.get_ticks_usec() - t0
		if elapsed_us > 8000 and _staged_layer < 5:
			last_chunk_build_ms = float(elapsed_us) / 1000.0
			return

	# All 5 layers completed
	_staged_node.update_lod(cur_zoom)
	active_chunks[_staged_key] = _staged_node
	last_chunk_build_ms = float(Time.get_ticks_usec() - t0) / 1000.0

	_staged_key = ""
	_staged_node = null
	_staged_data.clear()
	_staged_layer = 0

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

	# Gather candidate coordinates and sort by distance from camera
	var candidates: Array = []
	for dx in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
		for dy in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
			candidates.append(Vector2i(center_cx + dx, center_cy + dy))

	candidates.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		var dist_a = (a.x - center_cx) * (a.x - center_cx) + (a.y - center_cy) * (a.y - center_cy)
		var dist_b = (b.x - center_cx) * (b.x - center_cx) + (b.y - center_cy) * (b.y - center_cy)
		return dist_a < dist_b
	)

	for c in candidates:
		if loading_tasks.size() >= MAX_CONCURRENT_TASKS:
			return
		var k = "%d_%d" % [c.x, c.y]
		if not existing_keys.has(k):
			continue
		if active_chunks.has(k) or loading_tasks.has(k) or _is_in_ready_queue(k) or k == _staged_key:
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
# Background Worker Task: Read file, parse JSON, build Meshes
# Separates into land_base (always visible) and land_detail (LOD)
# -------------------------------------------------------------
func _worker_load_chunk(key: String, file_path: String) -> void:
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

	# 1. Base Land Mesh (Ground quad + major forests, water bodies, large fields)
	var land_base_builder = MeshBuilder.new()
	var land_detail_builder = MeshBuilder.new()

	var ox: float = float(cx) * CHUNK_SIZE
	var oy: float = float(cy) * CHUNK_SIZE
	land_base_builder.add_quad(
		Vector2(ox, oy),
		Vector2(ox + CHUNK_SIZE, oy),
		Vector2(ox + CHUNK_SIZE, oy + CHUNK_SIZE),
		Vector2(ox, oy + CHUNK_SIZE),
		BASE_GROUND_COLOR
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

		var bbox_area = (max_x - min_x) * (max_y - min_y)
		if bbox_area < 150.0:
			continue # Skip micro-slivers

		var tris = Geometry2D.triangulate_polygon(pts)
		if tris.is_empty():
			continue

		var col = LAND_COLORS.get(type_code, BASE_GROUND_COLOR)

		# LOD Classification:
		# Always in base (always visible): all forests (4, 10), water bodies (11), and large fields/zones (>= 3500 area)
		# Fine details (hidden when zoom < 0.6x): small residential garden plots and minor patches (< 3500 area)
		var is_base_feature = (type_code == 4 or type_code == 10 or type_code == 11 or bbox_area >= 3500.0)
		if is_base_feature:
			land_base_builder.add_polygon(pts, tris, col)
		else:
			land_detail_builder.add_polygon(pts, tris, col)

	result["land_base_mesh"] = land_base_builder.build_mesh()
	result["land_detail_mesh"] = land_detail_builder.build_mesh()

	# 2. Water Mesh (thick 7.0 px quads with bright clear blue)
	var water_builder = MeshBuilder.new()
	var raw_water = data.get("water", [])
	for flat in raw_water:
		var n: int = flat.size() / 2
		if n < 2:
			continue
		for i in range(n - 1):
			var p1 = Vector2(float(flat[i * 2]), float(flat[i * 2 + 1]))
			var p2 = Vector2(float(flat[(i + 1) * 2]), float(flat[(i + 1) * 2 + 1]))
			water_builder.add_thick_segment(p1, p2, 3.5, WATER_COLOR)

	result["water_mesh"] = water_builder.build_mesh()

	# 3. Rail Mesh (lines + sleepers as quads)
	var rail_builder = MeshBuilder.new()
	var raw_rail = data.get("rail", [])
	var rail_col = Color(0.38, 0.38, 0.42, 1.0)
	var sleeper_col = Color(0.24, 0.24, 0.27, 1.0)

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

	# 4. Buildings Mesh (light rooftop fills + thin dark contours)
	var bld_builder = MeshBuilder.new()
	var raw_bld = data.get("buildings", [])

	for b in raw_bld:
		if b.size() < 5:
			continue
		var bcx: float = float(b[0])
		var bcy: float = float(b[1])
		var bw: float = float(b[2])
		var bh: float = float(b[3])

		# Skip tiny micro-buildings (< 180 area or min dim < 6)
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

		# Crisp light rooftop
		bld_builder.add_quad(p1, p2, p3, p4, BLD_FILL_COLOR)

		# Sharp thin 0.8-unit outline
		bld_builder.add_thick_segment(p1, p2, 0.4, BLD_OUTLINE_COLOR)
		bld_builder.add_thick_segment(p2, p3, 0.4, BLD_OUTLINE_COLOR)
		bld_builder.add_thick_segment(p3, p4, 0.4, BLD_OUTLINE_COLOR)
		bld_builder.add_thick_segment(p4, p1, 0.4, BLD_OUTLINE_COLOR)

	result["buildings_mesh"] = bld_builder.build_mesh()

	_store_worker_result(key, result)

func _store_worker_result(key: String, result: Dictionary) -> void:
	if _is_exiting:
		return
	_mutex.lock()
	pending_results[key] = result
	_mutex.unlock()
