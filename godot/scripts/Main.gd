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
var draw_call_samples: Array = []
var show_f3_perf: bool = true

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
			if truck.has_method("reset_trailer_alignment"):
				truck.reset_trailer_alignment()
			print("[Main] Custom truck spawn position set to: (%.1f, %.1f)" % [sx, sy])

	if OS.has_environment("SCREENSHOT_FRAMES"):
		screenshot_frames = int(OS.get_environment("SCREENSHOT_FRAMES"))

	if OS.has_environment("SCREENSHOT"):
		should_screenshot = true
		var env_val = OS.get_environment("SCREENSHOT")
		if env_val != "" and env_val != "1" and env_val != "true":
			screenshot_target = env_val

	for arg in OS.get_cmdline_args():
		if arg.begins_with("--frames="):
			screenshot_frames = int(arg.substr("--frames=".length()))
		elif arg.begins_with("--screenshot="):
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

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_F3:
			show_f3_perf = not show_f3_perf

func _process(delta: float) -> void:
	frame_counter += 1
	var current_fps = int(round(1.0 / max(0.0001, delta)))
	var draw_calls = Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
	var objects_count = Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)

	# Sample steady state after first 30 setup frames
	if frame_counter > 30:
		fps_samples.append(current_fps)
		draw_call_samples.append(draw_calls)

	if debug_label:
		var pos = truck.global_position if truck else Vector2.ZERO
		var speed_kmh = 0.0
		var park_status = ""
		var artic_deg = 0.0
		var odo_km = 0.0
		var fuel_l = 0.0
		var zoom_val = 1.0
		if truck:
			if "current_speed" in truck:
				speed_kmh = Config.world_speed_to_kmh(truck.current_speed)
			if "parking_brake" in truck and truck.parking_brake:
				park_status = " [P]"
			if "articulation_angle" in truck:
				artic_deg = rad_to_deg(truck.articulation_angle)
			if "odometer_km" in truck:
				odo_km = truck.odometer_km
			if "fuel_litres" in truck:
				fuel_l = truck.fuel_litres
			if truck.camera:
				zoom_val = truck.camera.zoom.x

		var cx = int(floor(pos.x / 2048.0))
		var cy = int(floor(pos.y / 2048.0))
		var ecx = int(floor(pos.x / 8192.0))
		var ecy = int(floor(pos.y / 8192.0))
		var build_ms = env_world.last_chunk_build_ms if env_world else 0.0

		if show_f3_perf:
			debug_label.text = "FPS: %d | Draw Calls: %d | Objects: %d\nPos: (%.1f, %.1f) | Speed: %.1f km/h%s | Artic: %.1f°\nOdo: %.2f km | Fuel: %.1f L | Zoom: %.2fx | Scale: 1:%.0f\nRoad Chunk: %d_%d | Env Chunk: %d_%d | Chunk Build: %.1f ms\nF3: Toggle Stats | Space: Handbrake | Wheel: Zoom" % [
				current_fps, draw_calls, objects_count,
				pos.x, pos.y, speed_kmh, park_status, artic_deg,
				odo_km, fuel_l, zoom_val, Config.DISTANCE_COMPRESSION,
				cx, cy, ecx, ecy, build_ms
			]
		else:
			debug_label.text = "FPS: %d | Speed: %.1f km/h%s | Artic: %.1f° | Odo: %.2f km | Fuel: %.1f L | F3: Stats" % [
				current_fps, speed_kmh, park_status, artic_deg, odo_km, fuel_l
			]

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

			var sum_dc = 0.0
			for dc in draw_call_samples:
				sum_dc += dc
			var avg_dc = sum_dc / max(1, draw_call_samples.size())

			print("[Main] Measured over %d frames: FPS %.1f (min: %d, max: %d) | Draw Calls: %.0f | Chunk Build: %.1f ms" % [
				fps_samples.size(), avg_fps, min_fps, max_fps, avg_dc, env_world.last_chunk_build_ms if env_world else 0.0
			])
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
