extends Node2D

@onready var env_world = $EnvWorld
@onready var road_world = $RoadWorld
@onready var truck = $Truck
@onready var debug_label = $CanvasLayer/DebugLabel

var screenshot_taken: bool = false
var frame_counter: int = 0
var should_screenshot: bool = false
var screenshot_target: String = "assets/screenshots/godot-chisinau.png"
var screenshot_frames: int = 120 # wait frames for chunks to stream and steady-state FPS
var fps_samples: Array = []

func _ready() -> void:
	if env_world and truck:
		env_world.truck_ref = truck
	if road_world and truck:
		road_world.truck_ref = truck

	# Check custom spawn position from env or args
	var custom_pos = ""
	if OS.has_environment("SPAWN_POS"):
		custom_pos = OS.get_environment("SPAWN_POS")
	for arg in OS.get_cmdline_args():
		if arg.begins_with("--pos="):
			custom_pos = arg.substr("--pos=".length())
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--pos="):
			custom_pos = arg.substr("--pos=".length())

	if custom_pos != "" and truck:
		var parts = custom_pos.split(",")
		if parts.size() >= 2:
			var sx = float(parts[0].strip_edges())
			var sy = float(parts[1].strip_edges())
			truck.position = Vector2(sx, sy)
			print("[Main] Custom truck spawn position set to: (%.1f, %.1f)" % [sx, sy])

	if OS.has_environment("SCREENSHOT"):
		should_screenshot = true
		var env_val = OS.get_environment("SCREENSHOT")
		if env_val != "" and env_val != "1" and env_val != "true":
			screenshot_target = env_val

	for arg in OS.get_cmdline_args():
		if arg.begins_with("--screenshot="):
			should_screenshot = true
			screenshot_target = arg.substr("--screenshot=".length())
		elif arg == "--screenshot":
			should_screenshot = true

	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--screenshot="):
			should_screenshot = true
			screenshot_target = arg.substr("--screenshot=".length())
		elif arg == "--screenshot":
			should_screenshot = true

func _process(_delta: float) -> void:
	frame_counter += 1
	var current_fps = Engine.get_frames_per_second()
	if frame_counter > 40:
		fps_samples.append(current_fps)

	if debug_label:
		var pos = truck.global_position if truck else Vector2.ZERO
		var speed_kmh = 0.0
		if truck and "current_speed" in truck:
			speed_kmh = abs(truck.current_speed / 1.25) * 3.6
		var cx = int(floor(pos.x / 2048.0))
		var cy = int(floor(pos.y / 2048.0))
		var ecx = int(floor(pos.x / 8192.0))
		var ecy = int(floor(pos.y / 8192.0))
		debug_label.text = "FPS: %d\nPos: (%.1f, %.1f)\nRoad Chunk: %d_%d\nEnv Chunk: %d_%d\nSpeed: %.1f km/h\nControls: WASD / Arrows | Wheel Zoom" % [current_fps, pos.x, pos.y, cx, cy, ecx, ecy, speed_kmh]

	if should_screenshot and not screenshot_taken and frame_counter >= screenshot_frames:
		screenshot_taken = true
		if not fps_samples.is_empty():
			var sum_fps = 0.0
			var min_fps = 9999
			var max_fps = 0
			for f in fps_samples:
				sum_fps += f
				if f < min_fps: min_fps = f
				if f > max_fps: max_fps = f
			var avg_fps = sum_fps / fps_samples.size()
			print("[Main] Measured FPS over %d frames: %.1f (min: %d, max: %d)" % [fps_samples.size(), avg_fps, min_fps, max_fps])
		take_screenshot(screenshot_target)

func take_screenshot(target_path: String) -> void:
	await RenderingServer.frame_post_draw
	var viewport = get_viewport()
	var img = viewport.get_texture().get_image()
	if img:
		var global_target = target_path
		if not target_path.is_absolute_path():
			var repo_root = ProjectSettings.globalize_path("res://").path_join("..")
			global_target = repo_root.path_join(target_path).simplify_path()

		var dir = global_target.get_base_dir()
		if dir != "":
			DirAccess.make_dir_recursive_absolute(dir)
		var err = img.save_png(global_target)
		if err == OK:
			print("[Main] Screenshot successfully saved to: ", global_target)
		else:
			print("[Main] Failed to save screenshot: ", err)
	get_tree().quit(0)
