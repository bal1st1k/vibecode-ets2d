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
# EnvChunk: Single 8192-unit Chunk Node2D (draws ONCE via _draw)
# -------------------------------------------------------------
class EnvChunk extends Node2D:
	var chunk_rect: Rect2 = Rect2()
	var land_items: Array = [] # [PackedVector2Array, Color]
	var water_multiline: PackedVector2Array = PackedVector2Array()
	var rail_multiline: PackedVector2Array = PackedVector2Array()
	var rail_sleepers: PackedVector2Array = PackedVector2Array()
	var building_polys: Array = [] # PackedVector2Array (4 vertices)
	var building_outlines: PackedVector2Array = PackedVector2Array()

	func set_chunk_data(data: Dictionary) -> void:
		chunk_rect = data.get("rect", Rect2())
		land_items = data.get("land", [])
		water_multiline = data.get("water_multiline", PackedVector2Array())
		rail_multiline = data.get("rail_multiline", PackedVector2Array())
		rail_sleepers = data.get("sleepers", PackedVector2Array())
		building_polys = data.get("bld_polys", [])
		building_outlines = data.get("bld_outlines", PackedVector2Array())
		queue_redraw()

	func _draw() -> void:
		# 1. Background
		if chunk_rect.size != Vector2.ZERO:
			draw_rect(chunk_rect, Color(0.145, 0.173, 0.133, 1.0)) # #252c22

		# 2. Land polygons
		for item in land_items:
			draw_colored_polygon(item[0], item[1])

		# 3. Water waterways (batched)
		if water_multiline.size() >= 2:
			draw_multiline(water_multiline, Color(0.106, 0.157, 0.200, 1.0), 7.0)

		# 4. Railways (batched sleepers + rail lines)
		if rail_sleepers.size() >= 2:
			draw_multiline(rail_sleepers, Color(0.20, 0.20, 0.22, 1.0), 2.0)
		if rail_multiline.size() >= 2:
			draw_multiline(rail_multiline, Color(0.32, 0.32, 0.34, 1.0), 2.5)

		# 5. Buildings (fill + batched 1px outlines)
		var bld_fill = Color(0.235, 0.247, 0.255, 1.0)
		for poly in building_polys:
			draw_colored_polygon(poly, bld_fill)
		if building_outlines.size() >= 2:
			draw_multiline(building_outlines, Color(0.160, 0.169, 0.176, 1.0), 1.0)

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
				var chunk_node = EnvChunk.new()
				chunk_node.name = "EnvChunk_" + k
				chunk_node.set_chunk_data(item["data"])
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
# Background Worker Task: Read file, parse JSON, prepare structures
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

	# 1. Chunk rect
	result["rect"] = Rect2(float(cx) * CHUNK_SIZE, float(cy) * CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE)

	# 2. Land polygons
	var raw_land = data.get("land", [])
	raw_land.sort_custom(func(a, b):
		var pA = LAND_PRIORITY.get(int(a[0]), 99)
		var pB = LAND_PRIORITY.get(int(b[0]), 99)
		return pA < pB
	)

	var land_items: Array = []
	for entry in raw_land:
		if entry.size() < 2:
			continue
		var type_code: int = int(entry[0])
		var flat: Array = entry[1]
		var n: int = flat.size() / 2
		if n < 3:
			continue

		var pts: PackedVector2Array = PackedVector2Array()
		pts.resize(n)
		for i in range(n):
			pts[i] = Vector2(float(flat[i * 2]), float(flat[i * 2 + 1]))

		var tris = Geometry2D.triangulate_polygon(pts)
		if tris.is_empty():
			continue # Safely skip untriangulable polygon

		var col = LAND_COLORS.get(type_code, Color(0.145, 0.173, 0.133, 1.0))
		land_items.append([pts, col])

	result["land"] = land_items

	# 3. Waterways (batched into multiline)
	var raw_water = data.get("water", [])
	var water_multiline: PackedVector2Array = PackedVector2Array()
	for flat in raw_water:
		var n: int = flat.size() / 2
		if n < 2:
			continue
		for i in range(n - 1):
			water_multiline.append(Vector2(float(flat[i * 2]), float(flat[i * 2 + 1])))
			water_multiline.append(Vector2(float(flat[(i + 1) * 2]), float(flat[(i + 1) * 2 + 1])))

	result["water_multiline"] = water_multiline

	# 4. Railways (batched lines + sleepers)
	var raw_rail = data.get("rail", [])
	var rail_multiline: PackedVector2Array = PackedVector2Array()
	var rail_sleepers: PackedVector2Array = PackedVector2Array()
	for flat in raw_rail:
		var n: int = flat.size() / 2
		if n < 2:
			continue
		for i in range(n - 1):
			var p1 = Vector2(float(flat[i * 2]), float(flat[i * 2 + 1]))
			var p2 = Vector2(float(flat[(i + 1) * 2]), float(flat[(i + 1) * 2 + 1]))
			rail_multiline.append(p1)
			rail_multiline.append(p2)

			var d = p1.distance_to(p2)
			if d < 1.0:
				continue
			var dir = (p2 - p1) / d
			var norm = Vector2(-dir.y, dir.x) * 5.0
			var s: float = 0.0
			while s <= d:
				var mid = p1 + dir * s
				rail_sleepers.append(mid - norm)
				rail_sleepers.append(mid + norm)
				s += 16.0

	result["rail_multiline"] = rail_multiline
	result["sleepers"] = rail_sleepers

	# 5. Buildings (fill polygons + batched multiline outlines)
	var raw_bld = data.get("buildings", [])
	var bld_polys: Array = []
	var bld_outlines: PackedVector2Array = PackedVector2Array()
	for b in raw_bld:
		if b.size() < 5:
			continue
		var bcx: float = float(b[0])
		var bcy: float = float(b[1])
		var bw: float = float(b[2])
		var bh: float = float(b[3])
		var angle: float = float(b[4])
		var hw: float = bw * 0.5
		var hh: float = bh * 0.5
		var cos_a: float = cos(angle)
		var sin_a: float = sin(angle)

		var p1 = Vector2(bcx - hw * cos_a + hh * sin_a, bcy - hw * sin_a - hh * cos_a)
		var p2 = Vector2(bcx + hw * cos_a + hh * sin_a, bcy + hw * sin_a - hh * cos_a)
		var p3 = Vector2(bcx + hw * cos_a - hh * sin_a, bcy + hw * sin_a + hh * cos_a)
		var p4 = Vector2(bcx - hw * cos_a - hh * sin_a, bcy - hw * sin_a + hh * cos_a)

		bld_polys.append(PackedVector2Array([p1, p2, p3, p4]))

		# Outline segments
		bld_outlines.append(p1)
		bld_outlines.append(p2)
		bld_outlines.append(p2)
		bld_outlines.append(p3)
		bld_outlines.append(p3)
		bld_outlines.append(p4)
		bld_outlines.append(p4)
		bld_outlines.append(p1)

	result["bld_polys"] = bld_polys
	result["bld_outlines"] = bld_outlines

	_store_worker_result(key, result)

func _store_worker_result(key: String, result: Dictionary) -> void:
	if _is_exiting:
		return
	_mutex.lock()
	pending_results[key] = result
	_mutex.unlock()
