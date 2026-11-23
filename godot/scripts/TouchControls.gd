extends CanvasLayer

# TouchControls: Adaptive Mobile & Tablet Touch Interface for Android
# Supports virtual steering wheel with spring-return, analog gas/brake pedals,
# parking brake toggle, pause menu, and full multi-touch tracking within DisplayServer safe area.

signal pause_requested
signal parking_brake_toggled

@onready var root_control = $RootControl
@onready var safe_area_container = $RootControl/SafeAreaContainer
@onready var wheel_control = $RootControl/SafeAreaContainer/HUDLayout/SteeringWheel
@onready var gas_pedal = $RootControl/SafeAreaContainer/HUDLayout/PedalsContainer/GasPedal
@onready var brake_pedal = $RootControl/SafeAreaContainer/HUDLayout/PedalsContainer/BrakePedal
@onready var park_btn = $RootControl/SafeAreaContainer/HUDLayout/ParkingBrakeButton
@onready var pause_btn = $RootControl/SafeAreaContainer/HUDLayout/PauseButton
@onready var pause_overlay = $RootControl/PauseOverlay

var truck_ref: Node2D = null

# Multi-touch tracking IDs (-1 means inactive)
var steer_touch_id: int = -1
var gas_touch_id: int = -1
var brake_touch_id: int = -1

# Steering wheel state
var wheel_angle: float = 0.0 # Current angle in radians
var last_touch_angle: float = 0.0
const MAX_WHEEL_ROTATION: float = PI * 0.75 # 135 degrees max cut in either direction
const WHEEL_RETURN_SPEED: float = 9.0 # rad/s return speed when released

# Pedals analog state
var gas_strength: float = 0.0
var brake_strength: float = 0.0
var is_gas_pressed: bool = false
var is_brake_pressed: bool = false

# Pause state
var is_game_paused: bool = false

func _ready() -> void:
	layer = 20 # Render above standard game & HUD
	_update_visibility()
	_update_safe_area()

	# Connect window resize to safe area updates
	get_viewport().size_changed.connect(_on_viewport_size_changed)

	# Find truck in parent scene
	var main_scene = get_parent()
	if main_scene and main_scene.has_node("Truck"):
		truck_ref = main_scene.get_node("Truck")

	if pause_overlay:
		pause_overlay.visible = false

	if OS.has_environment("TOUCH_TEST_STEER"):
		wheel_angle = 0.85
		_apply_steering(wheel_angle)
		is_gas_pressed = true
		gas_strength = 0.90
		Input.action_press("accelerate", gas_strength)
		steer_touch_id = 999 # Keep turned during test
	elif OS.has_environment("TOUCH_TEST_PAUSE"):
		_toggle_pause()

func _on_viewport_size_changed() -> void:
	_update_safe_area()

func _update_visibility() -> void:
	# Show touch controls on touchscreen devices or when explicitly enabled in Config
	var should_show = Config.touch_controls_enabled
	if not should_show and DisplayServer.is_touchscreen_available():
		should_show = true
	if OS.has_environment("TOUCH_CONTROLS") and (OS.get_environment("TOUCH_CONTROLS") == "0" or OS.get_environment("TOUCH_CONTROLS") == "false"):
		should_show = false

	visible = should_show
	set_process_input(should_show)
	set_process(should_show)

func _update_safe_area() -> void:
	if not safe_area_container:
		return

	var safe_area = DisplayServer.get_display_safe_area()
	var screen_size = DisplayServer.screen_get_size()

	var margin_left = 20
	var margin_top = 16
	var margin_right = 20
	var margin_bottom = 16

	if safe_area.size.x > 0 and screen_size.x > 0:
		margin_left = max(20, safe_area.position.x)
		margin_top = max(16, safe_area.position.y)
		margin_right = max(20, screen_size.x - (safe_area.position.x + safe_area.size.x))
		margin_bottom = max(16, screen_size.y - (safe_area.position.y + safe_area.size.y))

	safe_area_container.add_theme_constant_override("margin_left", margin_left)
	safe_area_container.add_theme_constant_override("margin_top", margin_top)
	safe_area_container.add_theme_constant_override("margin_right", margin_right)
	safe_area_container.add_theme_constant_override("margin_bottom", margin_bottom)

func _process(delta: float) -> void:
	# Check if Config.touch_controls_enabled changed via F4
	var should_show = DisplayServer.is_touchscreen_available() or Config.touch_controls_enabled
	if visible != should_show:
		_update_visibility()

	if not visible:
		return

	# 1. Steering wheel spring return to center when finger is released
	if steer_touch_id == -1:
		if abs(wheel_angle) > 0.001:
			wheel_angle = move_toward(wheel_angle, 0.0, delta * WHEEL_RETURN_SPEED)
			_apply_steering(wheel_angle)
			if wheel_control:
				wheel_control.queue_redraw()
		else:
			if wheel_angle != 0.0:
				wheel_angle = 0.0
				_apply_steering(0.0)
				if wheel_control:
					wheel_control.queue_redraw()

	# 2. Update park brake visual status
	if park_btn:
		park_btn.queue_redraw()

func _input(event: InputEvent) -> void:
	if not visible:
		return

	# Handle screen touches and drags (works for both touchscreens and mouse with touch emulation)
	if event is InputEventScreenTouch:
		_handle_screen_touch(event)
	elif event is InputEventScreenDrag:
		_handle_screen_drag(event)
	elif event is InputEventMouseButton and not ProjectSettings.get_setting("input_devices/pointing/emulate_touch_from_mouse", false):
		# Fallback direct mouse support when touch emulation is off in desktop debug
		_handle_mouse_button(event)
	elif event is InputEventMouseMotion and not ProjectSettings.get_setting("input_devices/pointing/emulate_touch_from_mouse", false):
		_handle_mouse_motion(event)

func _handle_screen_touch(event: InputEventScreenTouch) -> void:
	var touch_pos = event.position
	var idx = event.index

	if event.pressed:
		# Check Pause button
		if pause_btn and pause_btn.get_global_rect().has_point(touch_pos):
			_toggle_pause()
			return

		# If paused, check pause overlay buttons
		if is_game_paused:
			_handle_pause_menu_touch(touch_pos)
			return

		# Check Parking Brake button
		if park_btn and park_btn.get_global_rect().has_point(touch_pos):
			_toggle_parking_brake()
			return

		# Check Steering Wheel
		if wheel_control:
			var w_rect = wheel_control.get_global_rect()
			var w_center = w_rect.get_center()
			var w_radius = min(w_rect.size.x, w_rect.size.y) * 0.55
			if touch_pos.distance_to(w_center) <= w_radius:
				steer_touch_id = idx
				last_touch_angle = (touch_pos - w_center).angle()
				return

		# Check Gas Pedal
		if gas_pedal and gas_pedal.get_global_rect().has_point(touch_pos):
			gas_touch_id = idx
			is_gas_pressed = true
			_update_gas_strength(touch_pos)
			if gas_pedal: gas_pedal.queue_redraw()
			return

		# Check Brake Pedal
		if brake_pedal and brake_pedal.get_global_rect().has_point(touch_pos):
			brake_touch_id = idx
			is_brake_pressed = true
			_update_brake_strength(touch_pos)
			if brake_pedal: brake_pedal.queue_redraw()
			return

	else:
		# Touch released
		if idx == steer_touch_id:
			steer_touch_id = -1
		elif idx == gas_touch_id:
			gas_touch_id = -1
			is_gas_pressed = false
			gas_strength = 0.0
			Input.action_release("accelerate")
			if gas_pedal: gas_pedal.queue_redraw()
		elif idx == brake_touch_id:
			brake_touch_id = -1
			is_brake_pressed = false
			brake_strength = 0.0
			Input.action_release("brake_reverse")
			if brake_pedal: brake_pedal.queue_redraw()

func _handle_screen_drag(event: InputEventScreenDrag) -> void:
	var idx = event.index
	var touch_pos = event.position

	if idx == steer_touch_id and wheel_control:
		var w_center = wheel_control.get_global_rect().get_center()
		var cur_angle = (touch_pos - w_center).angle()
		var delta_angle = wrapf(cur_angle - last_touch_angle, -PI, PI)
		wheel_angle = clamp(wheel_angle + delta_angle, -MAX_WHEEL_ROTATION, MAX_WHEEL_ROTATION)
		last_touch_angle = cur_angle
		_apply_steering(wheel_angle)
		wheel_control.queue_redraw()

	elif idx == gas_touch_id:
		_update_gas_strength(touch_pos)
		if gas_pedal: gas_pedal.queue_redraw()

	elif idx == brake_touch_id:
		_update_brake_strength(touch_pos)
		if brake_pedal: brake_pedal.queue_redraw()

func _handle_mouse_button(event: InputEventMouseButton) -> void:
	if event.button_index == MOUSE_BUTTON_LEFT:
		var fake_touch = InputEventScreenTouch.new()
		fake_touch.position = event.position
		fake_touch.index = 0
		fake_touch.pressed = event.pressed
		_handle_screen_touch(fake_touch)

func _handle_mouse_motion(event: InputEventMouseMotion) -> void:
	if event.button_mask & MOUSE_BUTTON_MASK_LEFT:
		var fake_drag = InputEventScreenDrag.new()
		fake_drag.position = event.position
		fake_drag.index = 0
		_handle_screen_drag(fake_drag)

func _apply_steering(angle: float) -> void:
	var ratio = angle / MAX_WHEEL_ROTATION # -1.0 to 1.0
	if ratio < -0.03:
		Input.action_press("steer_left", -ratio)
		Input.action_release("steer_right")
	elif ratio > 0.03:
		Input.action_press("steer_right", ratio)
		Input.action_release("steer_left")
	else:
		Input.action_release("steer_left")
		Input.action_release("steer_right")

func _update_gas_strength(touch_pos: Vector2) -> void:
	if not gas_pedal:
		return
	var rect = gas_pedal.get_global_rect()
	var rel_y = clamp((touch_pos.y - rect.position.y) / max(1.0, rect.size.y), 0.0, 1.0)
	# Touching deeper down on the pedal provides greater throttle (0.35 to 1.0)
	gas_strength = clamp(0.35 + rel_y * 0.65, 0.35, 1.0)
	Input.action_press("accelerate", gas_strength)

func _update_brake_strength(touch_pos: Vector2) -> void:
	if not brake_pedal:
		return
	var rect = brake_pedal.get_global_rect()
	var rel_y = clamp((touch_pos.y - rect.position.y) / max(1.0, rect.size.y), 0.0, 1.0)
	brake_strength = clamp(0.40 + rel_y * 0.60, 0.40, 1.0)
	Input.action_press("brake_reverse", brake_strength)

func _toggle_parking_brake() -> void:
	if truck_ref and is_instance_valid(truck_ref) and "parking_brake" in truck_ref:
		truck_ref.parking_brake = not truck_ref.parking_brake
	else:
		var ev_press = InputEventKey.new()
		ev_press.keycode = KEY_SPACE
		ev_press.pressed = true
		Input.parse_input_event(ev_press)
		var ev_rel = InputEventKey.new()
		ev_rel.keycode = KEY_SPACE
		ev_rel.pressed = false
		Input.parse_input_event(ev_rel)

	parking_brake_toggled.emit()
	if park_btn:
		park_btn.queue_redraw()

func _toggle_pause() -> void:
	is_game_paused = not is_game_paused
	get_tree().paused = is_game_paused
	if pause_overlay:
		pause_overlay.visible = is_game_paused
	pause_requested.emit()

func _handle_pause_menu_touch(pos: Vector2) -> void:
	if not pause_overlay:
		return
	var resume_btn = pause_overlay.get_node_or_null("Panel/VBoxContainer/ResumeButton")
	var restart_btn = pause_overlay.get_node_or_null("Panel/VBoxContainer/RestartButton")
	var quit_btn = pause_overlay.get_node_or_null("Panel/VBoxContainer/QuitButton")

	if resume_btn and resume_btn.get_global_rect().has_point(pos):
		_toggle_pause()
	elif restart_btn and restart_btn.get_global_rect().has_point(pos):
		get_tree().paused = false
		get_tree().reload_current_scene()
	elif quit_btn and quit_btn.get_global_rect().has_point(pos):
		get_tree().paused = false
		get_tree().quit(0)
