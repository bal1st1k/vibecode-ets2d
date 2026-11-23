extends Control

# Visual circular parking brake button [ (P) ] with red active status
var touch_controller: Node = null

func _ready() -> void:
	var p = get_parent()
	while p:
		if p.name == "TouchControls" or "truck_ref" in p:
			touch_controller = p
			break
		p = p.get_parent()

func _draw() -> void:
	var center = size * 0.5
	var r = min(size.x, size.y) * 0.46
	var is_active = false
	if touch_controller and touch_controller.truck_ref and "parking_brake" in touch_controller.truck_ref:
		is_active = touch_controller.truck_ref.parking_brake

	# Drop shadow
	draw_circle(center + Vector2(2, 2), r, Color(0, 0, 0, 0.35))

	# Background circle
	var bg = Color(0.85, 0.15, 0.15, 0.95) if is_active else Color(0.12, 0.15, 0.18, 0.85)
	draw_circle(center, r, bg)

	# Glowing border
	var border_col = Color(1.0, 0.40, 0.40, 1.0) if is_active else Color(0.40, 0.46, 0.54, 0.75)
	draw_arc(center, r, 0, TAU, 36, border_col, 3.0)

	# Stylized braking brackets around P: ( P )
	var font = ThemeDB.fallback_font
	var font_size = 26
	var p_color = Color(1.0, 1.0, 1.0, 1.0)
	draw_string(font, center + Vector2(-8, 9), "P", HORIZONTAL_ALIGNMENT_CENTER, -1, font_size, p_color)

	# Brake shoes curves: left bracket arc and right bracket arc
	draw_arc(center, r * 0.72, PI * 0.65, PI * 1.35, 16, p_color, 2.5)
	draw_arc(center, r * 0.72, -PI * 0.35, PI * 0.35, 16, p_color, 2.5)
