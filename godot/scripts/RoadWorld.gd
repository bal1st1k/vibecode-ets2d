extends Node2D

const CHUNK_SIZE: float = 2048.0
const VIEW_RADIUS: int = 3 # Keep chunks in 7x7 grid around player

var chunks_data: Dictionary = {} # Vector2i -> Dictionary(width: int -> PackedVector2Array)
var active_chunks: Dictionary = {} # Vector2i -> RoadChunk
var truck_ref: Node2D = null

# Inner class for drawing a chunk of roads
class RoadChunk extends Node2D:
	var width_batches: Dictionary = {}

	func set_data(data: Dictionary) -> void:
		width_batches = data
		queue_redraw()

	func _draw() -> void:
		# 1. Casing pass
		for w in width_batches.keys():
			var pts: PackedVector2Array = width_batches[w]
			if pts.size() >= 2:
				draw_multiline(pts, Color(0.25, 0.30, 0.27, 1.0), float(w) + 4.0)

		# 2. Asphalt pass
		for w in width_batches.keys():
			var pts: PackedVector2Array = width_batches[w]
			if pts.size() >= 2:
				draw_multiline(pts, Color(0.10, 0.12, 0.14, 1.0), float(w))

func _ready() -> void:
	load_roads_data("res://data/roads.json")

func load_roads_data(path: String) -> void:
	if not FileAccess.file_exists(path):
		push_error("Roads file not found: " + path)
		return

	var file = FileAccess.open(path, FileAccess.READ)
	if not file:
		push_error("Failed to open: " + path)
		return

	var json_text = file.get_as_text()
	var json = JSON.new()
	var err = json.parse(json_text)
	if err != OK:
		push_error("JSON Parse Error: " + json.get_error_message())
		return

	var raw_segments = json.data
	if not raw_segments is Array:
		push_error("roads.json is not an Array")
		return

	# Partition segments into 2048x2048 chunks
	for seg in raw_segments:
		if seg.size() < 5:
			continue
		var x1: float = float(seg[0])
		var y1: float = float(seg[1])
		var x2: float = float(seg[2])
		var y2: float = float(seg[3])
		var width: int = int(seg[4])

		var min_cx: int = int(floor(min(x1, x2) / CHUNK_SIZE))
		var max_cx: int = int(floor(max(x1, x2) / CHUNK_SIZE))
		var min_cy: int = int(floor(min(y1, y2) / CHUNK_SIZE))
		var max_cy: int = int(floor(max(y1, y2) / CHUNK_SIZE))

		for cx in range(min_cx, max_cx + 1):
			for cy in range(min_cy, max_cy + 1):
				var ckey = Vector2i(cx, cy)
				if not chunks_data.has(ckey):
					chunks_data[ckey] = {}
				var chunk_dict: Dictionary = chunks_data[ckey]
				if not chunk_dict.has(width):
					chunk_dict[width] = PackedVector2Array()
				chunk_dict[width].append(Vector2(x1, y1))
				chunk_dict[width].append(Vector2(x2, y2))

	print("[RoadWorld] Loaded %d road segments into %d chunks (2048x2048)." % [raw_segments.size(), chunks_data.size()])

func _process(_delta: float) -> void:
	var cam_pos: Vector2 = Vector2.ZERO
	if truck_ref and is_instance_valid(truck_ref):
		cam_pos = truck_ref.global_position
	else:
		var cam = get_viewport().get_camera_2d()
		if cam:
			cam_pos = cam.global_position

	update_visible_chunks(cam_pos)

func update_visible_chunks(center_pos: Vector2) -> void:
	var center_cx: int = int(floor(center_pos.x / CHUNK_SIZE))
	var center_cy: int = int(floor(center_pos.y / CHUNK_SIZE))

	var needed_keys: Dictionary = {}
	for dx in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
		for dy in range(-VIEW_RADIUS, VIEW_RADIUS + 1):
			var key = Vector2i(center_cx + dx, center_cy + dy)
			if chunks_data.has(key):
				needed_keys[key] = true

	# Free chunks that are no longer needed
	var keys_to_remove: Array = []
	for key in active_chunks.keys():
		if not needed_keys.has(key):
			var node = active_chunks[key]
			if is_instance_valid(node):
				node.queue_free()
			keys_to_remove.append(key)

	for key in keys_to_remove:
		active_chunks.erase(key)

	# Instantiate newly needed chunks
	for key in needed_keys.keys():
		if not active_chunks.has(key):
			var chunk_node = RoadChunk.new()
			chunk_node.name = "Chunk_%d_%d" % [key.x, key.y]
			chunk_node.set_data(chunks_data[key])
			add_child(chunk_node)
			active_chunks[key] = chunk_node
