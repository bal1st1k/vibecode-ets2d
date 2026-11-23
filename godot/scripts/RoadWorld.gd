extends Node2D

const CHUNK_SIZE: float = 2048.0
const VIEW_RADIUS: int = 2 # 5x5 grid: 10240x10240 world units (spans 3x screen size)
const UNLOAD_RADIUS: int = 3 # Free chunks beyond 7x7 radius
const MAX_CONCURRENT_TASKS: int = 2

# Visual Palette: Clean cool-slate asphalt contrasting with warm/olive EnvWorld
const CASING_COLOR: Color = Color(0.065, 0.082, 0.102, 1.0) # #11151a sharp dark border
const CASING_SCALE: float = 1.12 # +12% width for casing
const MARKING_COLOR: Color = Color(0.935, 0.945, 0.960, 1.0) # Crisp white/cream
const MARK_HALF_W: float = 1.0 # 2.0-unit marking width (~1.6m in real scale)

const PARAPET_COLOR: Color = Color(0.550, 0.608, 0.680, 1.0) # Steel/concrete parapet
const PARAPET_POST_COLOR: Color = Color(0.280, 0.330, 0.400, 1.0)

# Road Tier Colors (drawn in exact painter's hierarchy from bottom to top: 0 -> 5)
const TIER_COLORS: Dictionary = {
	0: Color(0.115, 0.138, 0.165, 1.0), # Tier 0: Links, service, narrow roads (#1d232a)
	1: Color(0.130, 0.158, 0.190, 1.0), # Tier 1: 1-lane ramps with shoulder (#212830)
	2: Color(0.150, 0.185, 0.225, 1.0), # Tier 2: Tertiary / rural roads (#262f3a)
	3: Color(0.175, 0.215, 0.260, 1.0), # Tier 3: Primary / Secondary highways (#2d3742)
	4: Color(0.205, 0.250, 0.300, 1.0), # Tier 4: Major Motorway / Trunk (#34404d)
	5: Color(0.230, 0.275, 0.330, 1.0), # Tier 5: Bridges over rivers and valleys (#3b4654)
}

# -------------------------------------------------------------
# Fast Mesh Builder for 2D Colored Triangles
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

	func add_circle(center: Vector2, radius: float, col: Color, segments: int = 8) -> void:
		if radius < 0.5:
			return
		var base = vertices.size()
		vertices.append(center)
		colors.append(col)
		var step = TAU / float(segments)
		for i in range(segments):
			var a = float(i) * step
			vertices.append(center + Vector2(cos(a), sin(a)) * radius)
			colors.append(col)
		for i in range(segments):
			indices.append(base)
			indices.append(base + 1 + i)
			indices.append(base + 1 + ((i + 1) % segments))

	func add_dashed_line(p1: Vector2, p2: Vector2, half_w: float, col: Color, dash_len: float = 20.0, gap_len: float = 20.0) -> void:
		var total_d = p1.distance_to(p2)
		if total_d < 1.0:
			return
		var dir = (p2 - p1) / total_d
		var norm = Vector2(-dir.y, dir.x) * half_w
		var s: float = 0.0
		while s < total_d:
			var s_end = min(s + dash_len, total_d)
			if s_end > s + 1.0:
				var m1 = p1 + dir * s
				var m2 = p1 + dir * s_end
				add_quad(m1 - norm, m1 + norm, m2 + norm, m2 - norm, col)
			s += dash_len + gap_len

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
# RoadChunk: Single MeshInstance2D per 2048-unit Chunk
# -------------------------------------------------------------
class RoadChunk extends Node2D:
	var mi: MeshInstance2D = null

	func set_road_mesh(mesh: ArrayMesh) -> void:
		if mesh:
			if not mi:
				mi = MeshInstance2D.new()
				mi.name = "RoadMesh"
				add_child(mi)
			mi.mesh = mesh

# -------------------------------------------------------------
# RoadWorld Management & WorkerThreadPool Streaming
# -------------------------------------------------------------
var chunks_data: Dictionary = {} # Vector2i -> Array of segments
var intersection_nodes: Dictionary = {} # Vector2i -> true (nodes with degree >= 3)
var active_chunks: Dictionary = {} # Vector2i -> RoadChunk
var loading_tasks: Dictionary = {} # Vector2i -> int (task_id)
var pending_results: Dictionary = {} # Vector2i -> ArrayMesh
var ready_queue: Array = [] # Array of Dictionary { "key": Vector2i, "mesh": ArrayMesh }
var truck_ref: Node2D = null

var _mutex: Mutex = Mutex.new()
var _is_exiting: bool = false

func _ready() -> void:
	z_index = -5 # Under Truck (0), above EnvWorld (-10)
	load_roads_data("res://data/roads.json")

func _exit_tree() -> void:
	_is_exiting = true
	for task_id in loading_tasks.values():
		WorkerThreadPool.wait_for_task_completion(task_id)
	loading_tasks.clear()

func load_roads_data(path: String) -> void:
	if not FileAccess.file_exists(path):
		push_error("[RoadWorld] Roads file not found: " + path)
		return

	var file = FileAccess.open(path, FileAccess.READ)
	if not file:
		push_error("[RoadWorld] Failed to open: " + path)
		return

	var json_text = file.get_as_text()
	var json = JSON.new()
	if json.parse(json_text) != OK:
		push_error("[RoadWorld] JSON Parse Error: " + json.get_error_message())
		return

	var raw_segments = json.data
	if not raw_segments is Array:
		push_error("[RoadWorld] roads.json is not an Array")
		return

	# 1. Count node degrees to identify intersection junctions
	var node_degree: Dictionary = {}
	for seg in raw_segments:
		if seg.size() < 5:
			continue
		var k1 = Vector2i(int(seg[0]), int(seg[1]))
		var k2 = Vector2i(int(seg[2]), int(seg[3]))
		node_degree[k1] = node_degree.get(k1, 0) + 1
		node_degree[k2] = node_degree.get(k2, 0) + 1

	for k in node_degree.keys():
		if node_degree[k] >= 3:
			intersection_nodes[k] = true
	node_degree.clear()

	# 2. Partition segments into 2048x2048 chunks
	for seg in raw_segments:
		if seg.size() < 5:
			continue
		var x1: float = float(seg[0])
		var y1: float = float(seg[1])
		var x2: float = float(seg[2])
		var y2: float = float(seg[3])

		var min_cx: int = int(floor(min(x1, x2) / CHUNK_SIZE))
		var max_cx: int = int(floor(max(x1, x2) / CHUNK_SIZE))
		var min_cy: int = int(floor(min(y1, y2) / CHUNK_SIZE))
		var max_cy: int = int(floor(max(y1, y2) / CHUNK_SIZE))

		for cx in range(min_cx, max_cx + 1):
			for cy in range(min_cy, max_cy + 1):
				var ckey = Vector2i(cx, cy)
				if not chunks_data.has(ckey):
					chunks_data[ckey] = []
				chunks_data[ckey].append(seg)

	print("[RoadWorld] Loaded %d road segments into %d chunks (2048x2048). Intersections: %d" % [
		raw_segments.size(), chunks_data.size(), intersection_nodes.size()
	])

func _process(_delta: float) -> void:
	# 1. Collect completed worker tasks
	_check_worker_tasks()

	# 2. Instantiate at most 1 ready chunk per frame
	_spawn_pending_chunk()

	# 3. Determine camera position
	var cam_pos: Vector2 = Vector2.ZERO
	if truck_ref and is_instance_valid(truck_ref):
		cam_pos = truck_ref.global_position
	else:
		var cam = get_viewport().get_camera_2d()
		if cam:
			cam_pos = cam.global_position

	var center_cx: int = int(floor(cam_pos.x / CHUNK_SIZE))
	var center_cy: int = int(floor(cam_pos.y / CHUNK_SIZE))

	# 4. Unload chunks beyond UNLOAD_RADIUS
	_unload_distant_chunks(center_cx, center_cy)

	# 5. Request chunks in VIEW_RADIUS
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
		var mesh = pending_results.get(k, null)
		pending_results.erase(k)
		_mutex.unlock()

		if mesh:
			ready_queue.append({ "key": k, "mesh": mesh })

func _spawn_pending_chunk() -> void:
	if ready_queue.is_empty():
		return

	var cam_pos: Vector2 = Vector2.ZERO
	if truck_ref and is_instance_valid(truck_ref):
		cam_pos = truck_ref.global_position
	var center_cx: int = int(floor(cam_pos.x / CHUNK_SIZE))
	var center_cy: int = int(floor(cam_pos.y / CHUNK_SIZE))

	# Prioritize chunks closest to the camera
	ready_queue.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var ka: Vector2i = a["key"]
		var kb: Vector2i = b["key"]
		var dist_a = (ka.x - center_cx) * (ka.x - center_cx) + (ka.y - center_cy) * (ka.y - center_cy)
		var dist_b = (kb.x - center_cx) * (kb.x - center_cx) + (kb.y - center_cy) * (kb.y - center_cy)
		return dist_a < dist_b
	)

	while not ready_queue.is_empty():
		var item = ready_queue.pop_front()
		var k: Vector2i = item["key"]
		if abs(k.x - center_cx) <= UNLOAD_RADIUS and abs(k.y - center_cy) <= UNLOAD_RADIUS:
			if not active_chunks.has(k):
				var chunk_node = RoadChunk.new()
				chunk_node.name = "RoadChunk_%d_%d" % [k.x, k.y]
				add_child(chunk_node)
				chunk_node.set_road_mesh(item["mesh"])
				active_chunks[k] = chunk_node
				break # At most 1 chunk instantiated per frame!

func _unload_distant_chunks(center_cx: int, center_cy: int) -> void:
	var to_remove: Array = []
	for k in active_chunks.keys():
		if abs(k.x - center_cx) > UNLOAD_RADIUS or abs(k.y - center_cy) > UNLOAD_RADIUS:
			var node = active_chunks[k]
			if is_instance_valid(node):
				node.queue_free()
			to_remove.append(k)

	for k in to_remove:
		active_chunks.erase(k)

func _request_visible_chunks(center_cx: int, center_cy: int) -> void:
	if loading_tasks.size() >= MAX_CONCURRENT_TASKS:
		return

	# Gather candidate chunk keys and sort by distance from center
	var candidates: Array = []
	for dx in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
		for dy in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
			candidates.append(Vector2i(center_cx + dx, center_cy + dy))

	candidates.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		var dist_a = (a.x - center_cx) * (a.x - center_cx) + (a.y - center_cy) * (a.y - center_cy)
		var dist_b = (b.x - center_cx) * (b.x - center_cx) + (b.y - center_cy) * (b.y - center_cy)
		return dist_a < dist_b
	)

	for k in candidates:
		if loading_tasks.size() >= MAX_CONCURRENT_TASKS:
			return
		if not chunks_data.has(k):
			continue
		if active_chunks.has(k) or loading_tasks.has(k) or _is_in_ready_queue(k):
			continue

		var segments = chunks_data[k]
		var task_id = WorkerThreadPool.add_task(_worker_build_chunk.bind(k, segments))
		loading_tasks[k] = task_id

func _is_in_ready_queue(key: Vector2i) -> bool:
	for item in ready_queue:
		if item["key"] == key:
			return true
	return false

# -------------------------------------------------------------
# Background Worker Task: Build Multi-Layered Road ArrayMesh
# Layer order: Casings -> Asphalt (Tiers 0..5) -> Markings & Parapets
# -------------------------------------------------------------
func _worker_build_chunk(key: Vector2i, segments: Array) -> void:
	var builder = MeshBuilder.new()

	# Group segments into 6 tiers:
	# 0: links/service, 1: ramps/oneways, 2: tertiary/rural, 3: primary/sec, 4: motorway/trunk, 5: bridges
	var tier_segments = [[], [], [], [], [], []]
	for seg in segments:
		var w = float(seg[4])
		var tier = int(seg[5]) if seg.size() > 5 else _get_tier_from_width(w)
		var is_br = bool(seg[6]) if seg.size() > 6 else false
		if is_br:
			tier_segments[5].append(seg)
		else:
			var t_idx = clamp(tier, 0, 4)
			tier_segments[t_idx].append(seg)

	# =========================================================
	# Layer 1: Casing (Обводка) - Bottom
	# =========================================================
	var casing_nodes: Dictionary = {}
	for t in range(6):
		var segs = tier_segments[t]
		for seg in segs:
			var p1 = Vector2(float(seg[0]), float(seg[1]))
			var p2 = Vector2(float(seg[2]), float(seg[3]))
			var w = float(seg[4]) * CASING_SCALE
			builder.add_thick_segment(p1, p2, w * 0.5, CASING_COLOR)
			var k1 = Vector2i(round(p1.x), round(p1.y))
			var k2 = Vector2i(round(p2.x), round(p2.y))
			casing_nodes[k1] = max(casing_nodes.get(k1, 0.0), w * 0.5)
			casing_nodes[k2] = max(casing_nodes.get(k2, 0.0), w * 0.5)

	# Round caps and joins for casing
	for node_pos in casing_nodes.keys():
		builder.add_circle(Vector2(node_pos), casing_nodes[node_pos], CASING_COLOR, 8)

	# =========================================================
	# Layer 2: Asphalt (Асфальт) - Middle (Tiers 0..5 in order)
	# =========================================================
	for t in range(6):
		var segs = tier_segments[t]
		if segs.is_empty():
			continue
		var col: Color = TIER_COLORS[t]
		var tier_nodes: Dictionary = {}
		for seg in segs:
			var p1 = Vector2(float(seg[0]), float(seg[1]))
			var p2 = Vector2(float(seg[2]), float(seg[3]))
			var w = float(seg[4])
			builder.add_thick_segment(p1, p2, w * 0.5, col)
			var k1 = Vector2i(round(p1.x), round(p1.y))
			var k2 = Vector2i(round(p2.x), round(p2.y))
			tier_nodes[k1] = max(tier_nodes.get(k1, 0.0), w * 0.5)
			tier_nodes[k2] = max(tier_nodes.get(k2, 0.0), w * 0.5)

		# Round caps and joins for this asphalt tier
		for node_pos in tier_nodes.keys():
			builder.add_circle(Vector2(node_pos), tier_nodes[node_pos], col, 8)

	# =========================================================
	# Layer 3: Markings & Parapets (Разметка и мосты) - Top
	# =========================================================
	for t in range(6):
		var segs = tier_segments[t]
		for seg in segs:
			var p1 = Vector2(float(seg[0]), float(seg[1]))
			var p2 = Vector2(float(seg[2]), float(seg[3]))
			var seg_len = p1.distance_to(p2)
			if seg_len < 1.0:
				continue
			var w = float(seg[4])
			var k1 = Vector2i(round(p1.x), round(p1.y))
			var k2 = Vector2i(round(p2.x), round(p2.y))

			var dir = (p2 - p1) / seg_len
			var norm = Vector2(-dir.y, dir.x)

			# Bridge safety parapets & steel guardrails
			if t == 5:
				var parapet_w = 2.5
				var p_off = w * 0.5 + 1.5
				builder.add_thick_segment(p1 - norm * p_off, p2 - norm * p_off, parapet_w, PARAPET_COLOR)
				builder.add_thick_segment(p1 + norm * p_off, p2 + norm * p_off, parapet_w, PARAPET_COLOR)

			# Trim markings at degree >= 3 intersections by ~1 road width
			var trim_start = w if intersection_nodes.has(k1) else 0.0
			var trim_end = w if intersection_nodes.has(k2) else 0.0

			if seg_len <= trim_start + trim_end + 4.0:
				continue

			var s_pt = p1 + dir * trim_start
			var e_pt = p2 - dir * trim_end

			# Road Class Lane Markings
			if t == 1:
				# Single-lane ramps/oneways with shoulders: outer edge lines
				builder.add_thick_segment(s_pt - norm * 18.0, e_pt - norm * 18.0, MARK_HALF_W, MARKING_COLOR)
				builder.add_thick_segment(s_pt + norm * 18.0, e_pt + norm * 18.0, MARK_HALF_W, MARKING_COLOR)
			elif t == 2:
				# 2-lane tertiary/rural roads: dashed centerline only (no outer shoulders)
				builder.add_dashed_line(s_pt, e_pt, MARK_HALF_W, MARKING_COLOR, 20.0, 20.0)
			elif t == 3 or t == 5:
				# 2-lane primary/secondary highways: dashed centerline + solid white edge lines
				builder.add_dashed_line(s_pt, e_pt, MARK_HALF_W, MARKING_COLOR, 20.0, 20.0)
				builder.add_thick_segment(s_pt - norm * 36.0, e_pt - norm * 36.0, MARK_HALF_W, MARKING_COLOR)
				builder.add_thick_segment(s_pt + norm * 36.0, e_pt + norm * 36.0, MARK_HALF_W, MARKING_COLOR)
			elif t == 4:
				# 3-lane major motorways/trunks: double solid centerline + dashed lane line + edge lines
				builder.add_thick_segment(s_pt - norm * 2.5, e_pt - norm * 2.5, MARK_HALF_W * 0.8, MARKING_COLOR)
				builder.add_thick_segment(s_pt + norm * 2.5, e_pt + norm * 2.5, MARK_HALF_W * 0.8, MARKING_COLOR)
				builder.add_dashed_line(s_pt + norm * 36.0, e_pt + norm * 36.0, MARK_HALF_W, MARKING_COLOR, 20.0, 20.0)
				builder.add_thick_segment(s_pt - norm * 54.0, e_pt - norm * 54.0, MARK_HALF_W, MARKING_COLOR)
				builder.add_thick_segment(s_pt + norm * 54.0, e_pt + norm * 54.0, MARK_HALF_W, MARKING_COLOR)

	var mesh = builder.build_mesh()
	_store_worker_result(key, mesh)

func _store_worker_result(key: Vector2i, mesh: ArrayMesh) -> void:
	if _is_exiting:
		return
	_mutex.lock()
	pending_results[key] = mesh
	_mutex.unlock()

func _get_tier_from_width(w: float) -> int:
	if w <= 36.0: return 0 # link/service
	if w <= 56.0: return 1 # 1-lane ramp
	if w <= 72.0: return 2 # tertiary/rural 2-lane
	if w <= 92.0: return 3 # primary/secondary 2-lane
	return 4 # motorway/trunk 3-lane
