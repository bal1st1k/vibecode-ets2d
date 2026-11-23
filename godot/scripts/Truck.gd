extends CharacterBody2D

# 2D Top-Down Truck Physics
@export var max_forward_speed: float = 750.0 # ~90 km/h in world units (1.25 px/m)
@export var max_reverse_speed: float = 200.0
@export var acceleration: float = 350.0
@export var braking: float = 600.0
@export var friction: float = 120.0
@export var steer_speed: float = 2.0 # rad/s max steering

var current_speed: float = 0.0 # scalar speed along facing direction

@onready var camera: Camera2D = $Camera2D

func _ready() -> void:
	if position == Vector2.ZERO or (position.x == 1200 and position.y == 3000):
		position = Vector2(1200, 2950)
		rotation = -PI / 2.0
	queue_redraw()

func _physics_process(delta: float) -> void:
	var throttle: float = 0.0
	if Input.is_action_pressed("accelerate") or Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		throttle += 1.0
	if Input.is_action_pressed("brake_reverse") or Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		throttle -= 1.0

	var steer_input: float = 0.0
	if Input.is_action_pressed("steer_left") or Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		steer_input -= 1.0
	if Input.is_action_pressed("steer_right") or Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		steer_input += 1.0

	# Speed update
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

	# Steering depends on motion
	if abs(current_speed) > 5.0:
		var speed_factor = clamp(abs(current_speed) / 300.0, 0.25, 1.0)
		var dir_factor = 1.0 if current_speed >= 0.0 else -1.0
		rotation += steer_input * steer_speed * speed_factor * dir_factor * delta

	# Velocity in facing direction
	var forward = Vector2.from_angle(rotation)
	velocity = forward * current_speed
	move_and_slide()

func _unhandled_input(event: InputEvent) -> void:
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

	# Drop shadow
	draw_rect(Rect2(-half_l + 3.0, -half_w + 3.0, cab_length, cab_width), Color(0.0, 0.0, 0.0, 0.35))

	# Chassis frame
	draw_rect(Rect2(-half_l, -half_w + 4.0, cab_length * 0.45, cab_width - 8.0), Color(0.12, 0.12, 0.14))

	# Wheels
	var wheel_w = 18.0
	var wheel_h = 7.0
	# Front wheels
	draw_rect(Rect2(half_l - 28.0, -half_w - 2.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.08))
	draw_rect(Rect2(half_l - 28.0, half_w - 5.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.08))
	# Rear wheels (dual)
	draw_rect(Rect2(-half_l + 8.0, -half_w - 2.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.08))
	draw_rect(Rect2(-half_l + 8.0, half_w - 5.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.08))

	# Main cabin body
	var cab_rect = Rect2(-half_l + 30.0, -half_w + 1.0, cab_length - 30.0, cab_width - 2.0)
	draw_rect(cab_rect, Color(0.0, 0.75, 0.9, 1.0)) # Vibrant cyan cab

	# Windshield
	var wind_rect = Rect2(half_l - 20.0, -half_w + 4.0, 8.0, cab_width - 8.0)
	draw_rect(wind_rect, Color(0.15, 0.25, 0.35, 1.0))

	# Roof aerodynamic deflector
	draw_rect(Rect2(-half_l + 35.0, -half_w + 5.0, 28.0, cab_width - 10.0), Color(0.0, 0.65, 0.8, 1.0))

	# Headlights
	draw_rect(Rect2(half_l - 2.0, -half_w + 2.0, 2.0, 6.0), Color(1.0, 0.95, 0.6, 1.0))
	draw_rect(Rect2(half_l - 2.0, half_w - 8.0, 2.0, 6.0), Color(1.0, 0.95, 0.6, 1.0))
