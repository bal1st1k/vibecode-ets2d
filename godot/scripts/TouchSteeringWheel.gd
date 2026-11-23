extends Control

# Visual virtual steering wheel with leather rim, 3 heavy spokes, and top cyan notch
var touch_controller: Node = null

func _ready() -> void:
	var p = get_parent()
	while p:
		if p.name == "TouchControls" or "wheel_angle" in p:
			touch_controller = p
			break
		p = p.get_parent()

func _draw() -> void:
	var center = size * 0.5
	var outer_r = min(size.x, size.y) * 0.48
	var rim_thick = 22.0
	var inner_r = outer_r - rim_thick
	var angle = touch_controller.wheel_angle if touch_controller else 0.0

	# 1. Subtle drop shadow
	draw_circle(center + Vector2(3, 3), outer_r, Color(0, 0, 0, 0.35))

	# Rotate canvas around center for wheel elements
	draw_set_transform(center, angle, Vector2.ONE)

	# 2. Outer rim (thick dark leather charcoal with subtle bevel)
	draw_arc(Vector2.ZERO, outer_r - rim_thick * 0.5, 0, TAU, 64, Color(0.13, 0.16, 0.19, 0.95), rim_thick)
	draw_arc(Vector2.ZERO, outer_r, 0, TAU, 64, Color(0.28, 0.34, 0.42, 0.9), 2.0)
	draw_arc(Vector2.ZERO, inner_r, 0, TAU, 64, Color(0.08, 0.10, 0.12, 0.9), 2.0)

	# 3. Top center alignment marker (Vibrant cyan notch on top of rim at -PI/2)
	draw_arc(Vector2.ZERO, outer_r - rim_thick * 0.5, -PI * 0.5 - 0.12, -PI * 0.5 + 0.12, 12, Color(0.0, 0.85, 1.0, 1.0), rim_thick)

	# 4. Three heavy steering spokes (Left at PI, Right at 0, Bottom at PI/2)
	var hub_r = 38.0
	# Left spoke
	draw_rect(Rect2(-inner_r, -10.0, inner_r - hub_r + 4.0, 20.0), Color(0.18, 0.22, 0.27, 0.95))
	draw_rect(Rect2(-inner_r, -2.0, inner_r - hub_r + 4.0, 4.0), Color(0.35, 0.42, 0.50, 0.9))
	# Right spoke
	draw_rect(Rect2(hub_r - 4.0, -10.0, inner_r - hub_r + 4.0, 20.0), Color(0.18, 0.22, 0.27, 0.95))
	draw_rect(Rect2(hub_r - 4.0, -2.0, inner_r - hub_r + 4.0, 4.0), Color(0.35, 0.42, 0.50, 0.9))
	# Bottom vertical spoke
	draw_rect(Rect2(-12.0, hub_r - 4.0, 24.0, inner_r - hub_r + 4.0), Color(0.18, 0.22, 0.27, 0.95))
	draw_rect(Rect2(-2.0, hub_r - 4.0, 4.0, inner_r - hub_r + 4.0), Color(0.35, 0.42, 0.50, 0.9))

	# 5. Central Hub (Horn pad & Chrome bezel)
	draw_circle(Vector2.ZERO, hub_r, Color(0.12, 0.14, 0.18, 0.98))
	draw_arc(Vector2.ZERO, hub_r, 0, TAU, 48, Color(0.50, 0.56, 0.65, 0.9), 3.0)
	draw_circle(Vector2.ZERO, hub_r - 8.0, Color(0.16, 0.19, 0.24, 1.0))
	# Horn icon symbol in center
	draw_arc(Vector2.ZERO, 10.0, -PI * 0.35, PI * 0.35, 16, Color(0.85, 0.90, 0.95, 0.8), 2.0)
	draw_arc(Vector2.ZERO, 16.0, -PI * 0.35, PI * 0.35, 16, Color(0.85, 0.90, 0.95, 0.6), 2.0)

	# Reset transform
	draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)
