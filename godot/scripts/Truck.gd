extends CharacterBody2D

# 2D Top-Down Truck Physics (Realistic European Semi-Truck with ETS2 1:8 Distance Compression)
# Physical dimensions in world units (matching src/engine.js, without DISTANCE_COMPRESSION scaling):
# ~6.8 m truck length, ~2.5 m width, ~4.0 m wheelbase, ~8.5 m kingpin-to-bogie
const CAB_LENGTH: float = 68.0
const CAB_WIDTH: float = 25.0
const WHEELBASE: float = 40.0        # meters between front steer and rear drive axle in world units
const HITCH_OFFSET: float = -16.0    # fifth wheel position behind truck center
const KINGPIN_TO_AXLE: float = 85.0  # distance from kingpin to trailer rear bogie center
const JACKKNIFE_LIMIT: float = 1.35  # ~77 degrees max articulation limit

var wheelbase: float = WHEELBASE
var hitch_offset: float = HITCH_OFFSET
var kingpin_to_axle: float = KINGPIN_TO_AXLE

# Speeds in world units/sec (90 km/h in world = 250 units/s with 1:8 compression)
@export var max_forward_speed: float = Config.kmh_to_world_speed(90.0) # 250.0 units/s
@export var max_reverse_speed: float = Config.kmh_to_world_speed(20.0) # 55.55 units/s
@export var acceleration: float = (Config.kmh_to_world_speed(90.0) / 5.5) # ~45.45 units/s² (0-90 km/h in 5.5s)
@export var braking: float = (Config.kmh_to_world_speed(90.0) / 2.2) # ~113.6 units/s² (90-0 km/h in 2.2s)
@export var friction: float = 1.2 * Config.MAP_SCALE * Config.DISTANCE_COMPRESSION # ~12.0 units/s² rolling drag
@export var steer_speed: float = 5.0 # rad/s max steering wheel turn rate

var current_speed: float = 0.0         # Scalar speed along facing direction in world units/s
var steer_angle: float = 0.0           # Current front wheel cut angle in radians
var max_steer: float = 0.58            # ~33 degrees max wheel cut
var parking_brake: bool = false        # Parking brake toggle (Space)
var articulation_angle: float = 0.0    # Angle difference between truck and trailer in radians
var test_mode: String = ""             # Automated test maneuver mode

# Telemetry
var odometer_km: float = 0.0           # Real km traveled
var fuel_litres: float = 580.0         # Fuel remaining (max 600L)
const FUEL_CAPACITY: float = 600.0

# Camera zoom: at 0 km/h: ~0.75x (> 0.6x, full LOD with buildings); at 90 km/h: ~0.50x (< 0.6x, simplified overview)
var base_zoom: float = 0.65
var manual_zoom_factor: float = 1.0    # Scaled by mouse wheel
var min_zoom: float = 0.12             # Furthest zoom out
var max_zoom: float = 2.00             # Closest zoom in

@export var trailer_path: NodePath = NodePath("../Trailer")
var trailer_ref: Node2D = null

@onready var camera: Camera2D = $Camera2D

func _ready() -> void:
	if not trailer_path.is_empty():
		trailer_ref = get_node_or_null(trailer_path)
	if not trailer_ref and get_parent():
		trailer_ref = get_parent().get_node_or_null("Trailer")

	# Check automated test args and environment variables
	if OS.has_environment("TEST_MODE"):
		test_mode = OS.get_environment("TEST_MODE")
		if test_mode == "handbrake":
			parking_brake = true
	elif OS.has_environment("TURN_TEST"):
		test_mode = "turn"
	elif OS.has_environment("REVERSE_TEST"):
		test_mode = "reverse"
	elif OS.has_environment("HANDBRAKE_TEST"):
		test_mode = "handbrake"
		parking_brake = true

	if OS.has_environment("TEST_SPEED"):
		var spd = float(OS.get_environment("TEST_SPEED"))
		current_speed = Config.kmh_to_world_speed(spd)
		test_mode = "speed"

	for arg in OS.get_cmdline_args():
		if arg == "--turn-test":
			test_mode = "turn"
		elif arg == "--reverse-test":
			test_mode = "reverse"
		elif arg == "--handbrake-test":
			test_mode = "handbrake"
			parking_brake = true
		elif arg.begins_with("--speed="):
			current_speed = Config.kmh_to_world_speed(float(arg.substr("--speed=".length())))
	for arg in OS.get_cmdline_user_args():
		if arg == "--turn-test":
			test_mode = "turn"
		elif arg == "--reverse-test":
			test_mode = "reverse"
		elif arg == "--handbrake-test":
			test_mode = "handbrake"
			parking_brake = true
		elif arg.begins_with("--speed="):
			current_speed = Config.kmh_to_world_speed(float(arg.substr("--speed=".length())))

	if position == Vector2.ZERO or (position.x == 1200 and position.y == 3000):
		position = Vector2(1200, 2950)
		rotation = -PI / 2.0

	reset_trailer_alignment()
	queue_redraw()

func reset_trailer_alignment() -> void:
	if trailer_ref and is_instance_valid(trailer_ref):
		trailer_ref.rotation = rotation
		var t_forward = Vector2.from_angle(rotation)
		var hitch_pos = global_position + t_forward * hitch_offset
		trailer_ref.global_position = hitch_pos - Vector2.from_angle(trailer_ref.rotation) * (kingpin_to_axle * 0.5)
		articulation_angle = 0.0

func _physics_process(delta: float) -> void:
	var throttle: float = 0.0
	var steer_input: float = 0.0

	if test_mode == "turn":
		if current_speed == 0.0:
			current_speed = Config.kmh_to_world_speed(60.0) # Start with 60 km/h roll
		throttle = 0.90
		steer_input = 0.85
	elif test_mode == "reverse":
		if current_speed == 0.0:
			current_speed = -Config.kmh_to_world_speed(15.0)
		throttle = -0.85
		steer_input = -0.80
	elif test_mode == "speed":
		var spd = float(OS.get_environment("TEST_SPEED")) if OS.has_environment("TEST_SPEED") else 90.0
		current_speed = Config.kmh_to_world_speed(spd)
		throttle = 0.5
	else:
		var accel_str = max(Input.get_action_strength("accelerate"), 1.0 if (Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP)) else 0.0)
		var brake_str = max(Input.get_action_strength("brake_reverse"), 1.0 if (Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN)) else 0.0)
		throttle = accel_str - brake_str

		var left_str = max(Input.get_action_strength("steer_left"), 1.0 if (Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT)) else 0.0)
		var right_str = max(Input.get_action_strength("steer_right"), 1.0 if (Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT)) else 0.0)
		steer_input = right_str - left_str

	# 1. Parking brake simulation
	if parking_brake:
		throttle = 0.0
		var park_decel = braking * 2.5
		current_speed = move_toward(current_speed, 0.0, park_decel * delta)
		if abs(current_speed) < 0.1:
			current_speed = 0.0
	else:
		# 2. Drive acceleration / service brake
		if throttle > 0.0:
			if current_speed < 0.0:
				current_speed = move_toward(current_speed, 0.0, braking * delta)
			else:
				current_speed = move_toward(current_speed, max_forward_speed, acceleration * delta)
		elif throttle < 0.0:
			if current_speed > 0.0:
				current_speed = move_toward(current_speed, 0.0, braking * delta)
			else:
				current_speed = move_toward(current_speed, -max_reverse_speed, acceleration * 0.8 * delta)
		else:
			current_speed = move_toward(current_speed, 0.0, friction * delta)

	# 3. Steering with speed-sensitive damping (matching src/engine.js)
	# High sensitivity at parking speeds, rock-solid stability at 90 km/h
	var speed_factor = 1.0 / (1.0 + abs(current_speed) * 0.003)
	var target_steer = steer_input * max_steer * speed_factor
	steer_angle = lerp(steer_angle, target_steer, 1.0 - exp(-delta * 9.0))

	# 4. Ackermann / Bicycle truck angular velocity
	var angular_velocity: float = 0.0
	if abs(current_speed) > 0.5:
		angular_velocity = (current_speed / wheelbase) * tan(steer_angle)
		rotation += angular_velocity * delta
		rotation = wrapf(rotation, -PI, PI)

	# 5. Truck velocity and motion
	var forward = Vector2.from_angle(rotation)
	velocity = forward * current_speed
	move_and_slide()

	# 6. Articulated Semi-Trailer Kinematics (following fifth wheel, matching src/engine.js)
	if trailer_ref and is_instance_valid(trailer_ref):
		# Velocity of hitch point on truck body
		var hitch_vx = velocity.x - sin(rotation) * hitch_offset * angular_velocity
		var hitch_vy = velocity.y + cos(rotation) * hitch_offset * angular_velocity

		# Lateral speed component relative to trailer orientation
		var tr_angle = trailer_ref.rotation
		var tr_lateral_speed = hitch_vx * sin(tr_angle) - hitch_vy * cos(tr_angle)

		# Trailer angular rate: sweeps inside turn curve when moving forward; folds when reversing
		var tr_angular_vel = -tr_lateral_speed / kingpin_to_axle

		# Update trailer rotation with jackknife protection limit (~86 deg / 1.5 rad)
		var new_rot = tr_angle + tr_angular_vel * delta
		var diff = wrapf(rotation - new_rot, -PI, PI)

		if abs(diff) >= JACKKNIFE_LIMIT:
			trailer_ref.rotation = wrapf(rotation - sign(diff) * JACKKNIFE_LIMIT, -PI, PI)
			articulation_angle = sign(diff) * JACKKNIFE_LIMIT
		else:
			trailer_ref.rotation = wrapf(new_rot, -PI, PI)
			articulation_angle = diff

		# Update trailer position so kingpin locks onto fifth wheel
		var forward_vec = Vector2(cos(rotation), sin(rotation))
		var hitch_pos = global_position + forward_vec * hitch_offset
		var tr_forward = Vector2(cos(trailer_ref.rotation), sin(trailer_ref.rotation))
		trailer_ref.global_position = hitch_pos - tr_forward * (kingpin_to_axle * 0.5)

	# 7. Odometer and Fuel simulation
	var dist_units = abs(current_speed) * delta
	var dist_real_km = (dist_units / Config.MAP_SCALE) / 1000.0
	odometer_km += dist_real_km
	var l_per_km = 0.33 + abs(throttle) * 0.12
	fuel_litres = max(0.0, fuel_litres - dist_real_km * l_per_km)

	# 8. Dynamic Camera Auto-Zoom based on speed + manual wheel adjustment
	if camera:
		var speed_ratio = clamp(abs(current_speed) / max_forward_speed, 0.0, 1.0)
		# At 0 km/h: ~0.75x base zoom (closer detail, buildings visible); At 90 km/h: ~0.50x base zoom (LOD switches off buildings)
		var target_zoom_val = clamp(base_zoom * manual_zoom_factor * (1.15 - 0.38 * speed_ratio), min_zoom, max_zoom)
		var cur_z = camera.zoom.x
		var new_z = lerp(cur_z, target_zoom_val, clamp(delta * 2.8, 0.0, 1.0))
		camera.zoom = Vector2(new_z, new_z)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_SPACE:
			parking_brake = not parking_brake

	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			manual_zoom_factor = clamp(manual_zoom_factor * 1.12, 0.35, 3.0)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			manual_zoom_factor = clamp(manual_zoom_factor * 0.88, 0.35, 3.0)

func _draw() -> void:
	# Semi-truck cab top-down dimensions: length 68.0, width 25.0 (~6.8m x 2.5m, matching src/engine.js)
	var cab_length: float = CAB_LENGTH
	var cab_width: float = CAB_WIDTH
	var half_l = cab_length * 0.5 # 34.0
	var half_w = cab_width * 0.5  # 12.5

	# 1. Drop shadow
	draw_rect(Rect2(-half_l + 2.5, -half_w + 2.5, cab_length, cab_width), Color(0.0, 0.0, 0.0, 0.35))

	# 2. Chassis frame & fuel tanks
	draw_rect(Rect2(-half_l, -half_w + 3.0, cab_length * 0.45, cab_width - 6.0), Color(0.12, 0.12, 0.14, 1.0))
	# Fuel tanks / exhaust boxes (aluminum)
	draw_rect(Rect2(-half_l + 10.0, -half_w - 1.0, 18.0, 2.5), Color(0.65, 0.65, 0.70, 1.0))
	draw_rect(Rect2(-half_l + 10.0, half_w - 1.5, 18.0, 2.5), Color(0.65, 0.65, 0.70, 1.0))

	# 3. Wheels (Steer axle at +20.0, Drive axle at -20.0, wheelbase = 40.0)
	var wheel_w = 14.0
	var wheel_h = 5.0
	# Front steer wheels
	draw_rect(Rect2(20.0 - wheel_w * 0.5, -half_w - 1.5, wheel_w, wheel_h), Color(0.08, 0.08, 0.09, 1.0))
	draw_rect(Rect2(20.0 - wheel_w * 0.5, half_w - 3.5, wheel_w, wheel_h), Color(0.08, 0.08, 0.09, 1.0))
	# Rear dual drive wheels
	draw_rect(Rect2(-20.0 - wheel_w * 0.5, -half_w - 1.5, wheel_w, wheel_h), Color(0.08, 0.08, 0.09, 1.0))
	draw_rect(Rect2(-20.0 - wheel_w * 0.5, half_w - 3.5, wheel_w, wheel_h), Color(0.08, 0.08, 0.09, 1.0))

	# 4. Fifth wheel coupling plate (skid plate at hitch_offset = -16.0)
	draw_circle(Vector2(hitch_offset, 0.0), 5.5, Color(0.20, 0.22, 0.25, 1.0))
	draw_circle(Vector2(hitch_offset, 0.0), 2.5, Color(0.08, 0.08, 0.10, 1.0))

	# 5. Main cabin body
	var cab_rect = Rect2(-half_l + 24.0, -half_w + 1.0, cab_length - 24.0, cab_width - 2.0)
	draw_rect(cab_rect, Color(0.0, 0.75, 0.90, 1.0)) # Vibrant cyan cab

	# 6. Windshield & Side Windows
	var wind_rect = Rect2(half_l - 15.0, -half_w + 3.0, 6.0, cab_width - 6.0)
	draw_rect(wind_rect, Color(0.15, 0.25, 0.35, 1.0))

	# 7. Roof aerodynamic deflector & side mirrors
	draw_rect(Rect2(-half_l + 28.0, -half_w + 4.0, 22.0, cab_width - 8.0), Color(0.0, 0.65, 0.80, 1.0))
	# Side mirrors
	draw_rect(Rect2(half_l - 12.0, -half_w - 4.0, 3.5, 3.5), Color(0.0, 0.70, 0.85, 1.0))
	draw_rect(Rect2(half_l - 12.0, half_w + 0.5, 3.5, 3.5), Color(0.0, 0.70, 0.85, 1.0))

	# 8. Headlights
	draw_rect(Rect2(half_l - 1.5, -half_w + 2.0, 1.5, 4.5), Color(1.0, 0.95, 0.60, 1.0))
	draw_rect(Rect2(half_l - 1.5, half_w - 6.5, 1.5, 4.5), Color(1.0, 0.95, 0.60, 1.0))
