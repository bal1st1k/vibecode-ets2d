extends CharacterBody2D

# 2D Top-Down Truck Physics (Realistic European Semi-Truck scaled by Config.MAP_SCALE)
# 90 km/h = 25.0 m/s = 31.25 world units/s at 1.25 units/m
@export var max_forward_speed: float = (90.0 / 3.6) * Config.MAP_SCALE # 31.25 units/s (~90 km/h)
@export var max_reverse_speed: float = (20.0 / 3.6) * Config.MAP_SCALE # 6.94 units/s (~20 km/h)
@export var acceleration: float = (90.0 / 3.6 / 5.5) * Config.MAP_SCALE # ~5.68 units/s² (0-90 km/h in 5.5s)
@export var braking: float = (90.0 / 3.6 / 2.0) * Config.MAP_SCALE # ~15.62 units/s² (90-0 km/h in 2.0s)
@export var friction: float = 1.2 * Config.MAP_SCALE # ~1.5 units/s² (rolling resistance)
@export var steer_speed: float = 2.5 # rad/s max steering rate

# Kinematic articulation constants (matching src/engine.js)
const WHEELBASE: float = 44.0          # Distance between front steer and rear drive axle
const HITCH_OFFSET: float = -26.0      # Fifth wheel position behind truck center
const KINGPIN_TO_AXLE: float = 105.0   # Distance from kingpin to trailer rear bogie center
const JACKKNIFE_LIMIT: float = 1.50    # ~86 degrees max articulation limit

var current_speed: float = 0.0         # Scalar speed along facing direction in world units/s
var steer_angle: float = 0.0           # Current front wheel cut angle in radians
var max_steer: float = 0.58            # ~33 degrees max wheel cut
var parking_brake: bool = false        # Parking brake toggle (Space)
var articulation_angle: float = 0.0    # Angle difference between truck and trailer in radians
var test_mode: String = ""             # Automated test maneuver mode

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

	for arg in OS.get_cmdline_args():
		if arg == "--turn-test":
			test_mode = "turn"
		elif arg == "--reverse-test":
			test_mode = "reverse"
		elif arg == "--handbrake-test":
			test_mode = "handbrake"
			parking_brake = true
	for arg in OS.get_cmdline_user_args():
		if arg == "--turn-test":
			test_mode = "turn"
		elif arg == "--reverse-test":
			test_mode = "reverse"
		elif arg == "--handbrake-test":
			test_mode = "handbrake"
			parking_brake = true

	if position == Vector2.ZERO or (position.x == 1200 and position.y == 3000):
		position = Vector2(1200, 2950)
		rotation = -PI / 2.0

	reset_trailer_alignment()
	queue_redraw()

func reset_trailer_alignment() -> void:
	if trailer_ref and is_instance_valid(trailer_ref):
		trailer_ref.rotation = rotation
		var t_forward = Vector2.from_angle(rotation)
		var hitch_pos = global_position + t_forward * HITCH_OFFSET
		trailer_ref.global_position = hitch_pos - Vector2.from_angle(trailer_ref.rotation) * (KINGPIN_TO_AXLE * 0.5)
		articulation_angle = 0.0

func _physics_process(delta: float) -> void:
	var throttle: float = 0.0
	var steer_input: float = 0.0

	if test_mode == "turn":
		if current_speed == 0.0:
			current_speed = 20.0 # Initial roll speed for test maneuver
		throttle = 0.95
		steer_input = 0.95
	elif test_mode == "reverse":
		if current_speed == 0.0:
			current_speed = -6.0 # Initial reverse speed for test maneuver
		throttle = -0.90
		steer_input = -0.90
	else:
		if Input.is_action_pressed("accelerate") or Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
			throttle += 1.0
		if Input.is_action_pressed("brake_reverse") or Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
			throttle -= 1.0

		if Input.is_action_pressed("steer_left") or Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
			steer_input -= 1.0
		if Input.is_action_pressed("steer_right") or Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
			steer_input += 1.0

	# 1. Parking brake simulation
	if parking_brake:
		throttle = 0.0
		var park_decel = braking * 2.5
		current_speed = move_toward(current_speed, 0.0, park_decel * delta)
		if abs(current_speed) < 0.05:
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

	# 3. Steering with speed-sensitive damping
	var speed_factor = 1.0 / (1.0 + abs(current_speed) * 0.05)
	var target_steer = steer_input * max_steer * speed_factor
	steer_angle = move_toward(steer_angle, target_steer, steer_speed * delta)

	# 4. Ackermann / Bicycle truck angular velocity
	var angular_velocity: float = 0.0
	if abs(current_speed) > 0.05:
		angular_velocity = (current_speed / WHEELBASE) * tan(steer_angle)
		rotation += angular_velocity * delta
		rotation = wrapf(rotation, -PI, PI)

	# 5. Truck velocity and motion
	var forward = Vector2.from_angle(rotation)
	velocity = forward * current_speed
	move_and_slide()

	# 6. Articulated Semi-Trailer Kinematics (following fifth wheel, matching src/engine.js)
	if trailer_ref and is_instance_valid(trailer_ref):
		# Velocity of hitch point on truck body
		var hitch_vx = velocity.x - sin(rotation) * HITCH_OFFSET * angular_velocity
		var hitch_vy = velocity.y + cos(rotation) * HITCH_OFFSET * angular_velocity

		# Lateral speed component relative to trailer orientation
		var tr_angle = trailer_ref.rotation
		var tr_lateral_speed = hitch_vx * sin(tr_angle) - hitch_vy * cos(tr_angle)

		# Trailer angular rate: sweeps inside turn curve when moving forward; folds when reversing
		var tr_angular_vel = -tr_lateral_speed / KINGPIN_TO_AXLE

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
		var hitch_pos = global_position + forward_vec * HITCH_OFFSET
		var tr_forward = Vector2(cos(trailer_ref.rotation), sin(trailer_ref.rotation))
		trailer_ref.global_position = hitch_pos - tr_forward * (KINGPIN_TO_AXLE * 0.5)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_SPACE:
			parking_brake = not parking_brake

	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			if camera:
				camera.zoom = (camera.zoom * 1.1).clamp(Vector2(0.25, 0.25), Vector2(3.0, 3.0))
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if camera:
				camera.zoom = (camera.zoom * 0.9).clamp(Vector2(0.25, 0.25), Vector2(3.0, 3.0))

func _draw() -> void:
	# Semi-truck cab top-down dimensions: length 80 px, width 32 px
	var cab_length: float = 80.0
	var cab_width: float = 32.0
	var half_l = cab_length * 0.5
	var half_w = cab_width * 0.5

	# 1. Drop shadow
	draw_rect(Rect2(-half_l + 3.0, -half_w + 3.0, cab_length, cab_width), Color(0.0, 0.0, 0.0, 0.35))

	# 2. Chassis frame & fuel tanks
	draw_rect(Rect2(-half_l, -half_w + 4.0, cab_length * 0.45, cab_width - 8.0), Color(0.12, 0.12, 0.14, 1.0))
	# Fuel tanks / exhaust boxes
	draw_rect(Rect2(-half_l + 12.0, -half_w - 1.0, 22.0, 3.0), Color(0.65, 0.65, 0.70, 1.0))
	draw_rect(Rect2(-half_l + 12.0, half_w - 2.0, 22.0, 3.0), Color(0.65, 0.65, 0.70, 1.0))

	# 3. Wheels
	var wheel_w = 18.0
	var wheel_h = 7.0
	# Front steer wheels
	draw_rect(Rect2(half_l - 28.0, -half_w - 2.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.08, 1.0))
	draw_rect(Rect2(half_l - 28.0, half_w - 5.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.08, 1.0))
	# Rear dual drive wheels
	draw_rect(Rect2(-half_l + 8.0, -half_w - 2.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.08, 1.0))
	draw_rect(Rect2(-half_l + 8.0, half_w - 5.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.08, 1.0))

	# 4. Fifth wheel coupling plate (skid plate at HITCH_OFFSET)
	draw_circle(Vector2(HITCH_OFFSET, 0.0), 6.5, Color(0.20, 0.22, 0.25, 1.0))
	draw_circle(Vector2(HITCH_OFFSET, 0.0), 3.0, Color(0.08, 0.08, 0.10, 1.0))

	# 5. Main cabin body
	var cab_rect = Rect2(-half_l + 30.0, -half_w + 1.0, cab_length - 30.0, cab_width - 2.0)
	draw_rect(cab_rect, Color(0.0, 0.75, 0.9, 1.0)) # Vibrant cyan cab

	# 6. Windshield
	var wind_rect = Rect2(half_l - 20.0, -half_w + 4.0, 8.0, cab_width - 8.0)
	draw_rect(wind_rect, Color(0.15, 0.25, 0.35, 1.0))

	# 7. Roof aerodynamic deflector & mirrors
	draw_rect(Rect2(-half_l + 35.0, -half_w + 5.0, 28.0, cab_width - 10.0), Color(0.0, 0.65, 0.8, 1.0))
	# Side mirrors
	draw_rect(Rect2(half_l - 16.0, -half_w - 5.0, 4.0, 4.0), Color(0.0, 0.70, 0.85, 1.0))
	draw_rect(Rect2(half_l - 16.0, half_w + 1.0, 4.0, 4.0), Color(0.0, 0.70, 0.85, 1.0))

	# 8. Headlights
	draw_rect(Rect2(half_l - 2.0, -half_w + 2.0, 2.0, 6.0), Color(1.0, 0.95, 0.6, 1.0))
	draw_rect(Rect2(half_l - 2.0, half_w - 8.0, 2.0, 6.0), Color(1.0, 0.95, 0.6, 1.0))
