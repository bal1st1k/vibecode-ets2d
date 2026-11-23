extends Control

# Visual accelerator / brake pedal with ribbed rubber tread, analog depression, and power bar
@export_enum("gas", "brake") var pedal_type: String = "gas"
var touch_controller: Node = null

func _ready() -> void:
	var p = get_parent()
	while p:
		if p.name == "TouchControls" or "is_gas_pressed" in p:
			touch_controller = p
			break
		p = p.get_parent()

func _draw() -> void:
	var is_pressed = false
	var strength = 0.0
	if touch_controller:
		if pedal_type == "gas":
			is_pressed = touch_controller.is_gas_pressed
			strength = touch_controller.gas_strength
		else:
			is_pressed = touch_controller.is_brake_pressed
			strength = touch_controller.brake_strength

	var press_offset = Vector2(0, 4) if is_pressed else Vector2.ZERO

	# 1. Base slot / shadow
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.06, 0.08, 0.10, 0.65))
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.20, 0.24, 0.30, 0.5), false, 2.0)

	# 2. Pedal plate
	var plate_margin = 4.0
	var plate_rect = Rect2(plate_margin + press_offset.x, plate_margin + press_offset.y, size.x - plate_margin * 2, size.y - plate_margin * 2)

	var bg_color = Color(0.14, 0.17, 0.21, 0.95)
	if is_pressed:
		bg_color = Color(0.08, 0.28, 0.20, 0.95) if pedal_type == "gas" else Color(0.35, 0.10, 0.12, 0.95)

	draw_rect(plate_rect, bg_color)
	# Bevel border
	var border_color = Color(0.0, 0.85, 0.60, 1.0) if (is_pressed and pedal_type == "gas") else (Color(1.0, 0.25, 0.25, 1.0) if (is_pressed and pedal_type == "brake") else Color(0.35, 0.40, 0.48, 0.8))
	draw_rect(plate_rect, border_color, false, 2.5)

	# 3. Ribbed rubber grip tread
	var grip_color = Color(0.08, 0.10, 0.12, 0.9)
	if pedal_type == "gas":
		# Vertical long ridges
		var rx = plate_rect.position.x + 12.0
		while rx < plate_rect.position.x + plate_rect.size.x - 10.0:
			draw_rect(Rect2(rx, plate_rect.position.y + 14.0, 4.0, plate_rect.size.y - 28.0), grip_color)
			rx += 12.0
	else:
		# Horizontal heavy bars for brake
		var ry = plate_rect.position.y + 16.0
		while ry < plate_rect.position.y + plate_rect.size.y - 14.0:
			draw_rect(Rect2(plate_rect.position.x + 10.0, ry, plate_rect.size.x - 20.0, 6.0), grip_color)
			ry += 16.0

	# 4. Text Label
	var font = ThemeDB.fallback_font
	var font_size = 18
	var label = "GAS" if pedal_type == "gas" else "BRAKE"
	var text_pos = plate_rect.position + Vector2(plate_rect.size.x * 0.5 - (18.0 if pedal_type == "gas" else 26.0), plate_rect.size.y * 0.5 + 6.0)
	draw_string(font, text_pos, label, HORIZONTAL_ALIGNMENT_CENTER, -1, font_size, Color(0.95, 0.98, 1.0, 0.95))

	# 5. Analog power level bar at the side
	if is_pressed and strength > 0.0:
		var bar_w = 4.0
		var bar_h = (plate_rect.size.y - 12.0) * strength
		var bar_x = plate_rect.position.x + plate_rect.size.x - bar_w - 3.0
		var bar_y = plate_rect.position.y + plate_rect.size.y - 6.0 - bar_h
		var bar_col = Color(0.0, 1.0, 0.6, 1.0) if pedal_type == "gas" else Color(1.0, 0.2, 0.2, 1.0)
		draw_rect(Rect2(bar_x, bar_y, bar_w, bar_h), bar_col)
