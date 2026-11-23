extends Node2D

@onready var road_world = $RoadWorld
@onready var truck = $Truck
@onready var debug_label = $CanvasLayer/DebugLabel

var screenshot_taken: bool = false
var frame_counter: int = 0
var should_screenshot: bool = false
var screenshot_target: String = "assets/screenshots/godot-chisinau.png"

func _ready() -> void:
	if road_world and truck:
		road_world.truck_ref = truck

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
	if debug_label:
		var fps = Engine.get_frames_per_second()
		var pos = truck.global_position if truck else Vector2.ZERO
		var speed_kmh = 0.0
		if truck and "current_speed" in truck:
			speed_kmh = abs(truck.current_speed / 1.25) * 3.6
		var cx = int(floor(pos.x / 2048.0))
		var cy = int(floor(pos.y / 2048.0))
		debug_label.text = "FPS: %d\nPos: (%.1f, %.1f)\nChunk: %d_%d\nSpeed: %.1f km/h\nControls: WASD / Arrows | Wheel Zoom" % [fps, pos.x, pos.y, cx, cy, speed_kmh]

	if should_screenshot and not screenshot_taken and frame_counter >= 30:
		screenshot_taken = true
		take_screenshot(screenshot_target)

func take_screenshot(target_path: String) -> void:
	await RenderingServer.frame_post_draw
	var viewport = get_viewport()
	var img = viewport.get_texture().get_image()
	if img:
		# Target path can be relative to project or absolute
		var global_target = target_path
		if not target_path.is_absolute_path():
			# If relative to repo root:
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
