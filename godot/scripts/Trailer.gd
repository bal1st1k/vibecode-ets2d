extends Node2D

# 2D Top-Down European Semi-Trailer (13.6m Standard Curtainsider / Reefer)
# Dimensions aligned with 36-unit road lanes: 136.0 units length (~13.6 m), 25.5 units width (~2.55 m)
@export var trailer_length: float = 136.0
@export var trailer_width: float = 25.5
@export var kingpin_offset: float = 42.5 # distance from center to kingpin hitch (85.0 * 0.5)

func _ready() -> void:
	z_index = 0
	queue_redraw()

func _draw() -> void:
	var half_l = trailer_length * 0.5 # 68.0
	var half_w = trailer_width * 0.5  # 12.75

	# 1. Soft drop shadow
	draw_rect(Rect2(-half_l + 3.0, -half_w + 3.0, trailer_length, trailer_width), Color(0.0, 0.0, 0.0, 0.35))

	# 2. Side underrun protection bars & landing gear
	# Retracted landing gear legs
	draw_rect(Rect2(half_l - 42.0, -half_w - 1.0, 4.0, trailer_width + 2.0), Color(0.18, 0.20, 0.24, 1.0))
	# Underrun side rails with yellow safety markers
	draw_rect(Rect2(-half_l + 28.0, -half_w - 1.2, 45.0, 2.2), Color(0.85, 0.75, 0.15, 0.95))
	draw_rect(Rect2(-half_l + 28.0, half_w - 1.0, 45.0, 2.2), Color(0.85, 0.75, 0.15, 0.95))

	# 3. Triple-axle rear bogie (6 wheels: 3 on left, 3 on right)
	# Bogie center is at -42.5, matching kingpin at +42.5 (distance = 85.0)
	var wheel_w = 12.0
	var wheel_h = 5.0
	var axle_x = [-52.5, -42.5, -32.5]
	for ax in axle_x:
		# Left wheels (tires + steel rim)
		draw_rect(Rect2(ax - wheel_w * 0.5, -half_w - 2.0, wheel_w, wheel_h), Color(0.08, 0.09, 0.11, 1.0))
		draw_rect(Rect2(ax - wheel_w * 0.25, -half_w - 1.0, wheel_w * 0.5, wheel_h - 2.0), Color(0.55, 0.58, 0.62, 1.0))
		# Right wheels (tires + steel rim)
		draw_rect(Rect2(ax - wheel_w * 0.5, half_w - 3.0, wheel_w, wheel_h), Color(0.08, 0.09, 0.11, 1.0))
		draw_rect(Rect2(ax - wheel_w * 0.25, half_w - 2.0, wheel_w * 0.5, wheel_h - 2.0), Color(0.55, 0.58, 0.62, 1.0))

	# 4. Steel frame & body perimeter outline
	# Dark border around full trailer box
	draw_rect(Rect2(-half_l, -half_w, trailer_length, trailer_width), Color(0.12, 0.14, 0.16, 1.0))

	# 5. Main tarpaulin tent body (Light silver-grey European curtainsider canvas, clearly distinct from asphalt)
	var tent_rect = Rect2(-half_l + 1.0, -half_w + 1.0, trailer_length - 2.0, trailer_width - 2.0)
	draw_rect(tent_rect, Color(0.82, 0.84, 0.87, 1.0)) # Crisp light silver canvas

	# Subtle tarpaulin roof arches / ribs across the roof
	var rib_x = -half_l + 15.0
	while rib_x < half_l - 10.0:
		draw_line(Vector2(rib_x, -half_w + 1.5), Vector2(rib_x, half_w - 1.5), Color(0.72, 0.75, 0.78, 1.0), 1.0)
		rib_x += 14.0

	# Center longitudinal tension band
	draw_line(Vector2(-half_l + 8.0, 0.0), Vector2(half_l - 8.0, 0.0), Color(0.76, 0.78, 0.81, 1.0), 1.5)

	# Side curtainsider livery stripe (Blue transport band)
	draw_rect(Rect2(-half_l + 8.0, -half_w + 1.5, trailer_length - 16.0, 2.0), Color(0.20, 0.45, 0.85, 1.0))
	draw_rect(Rect2(-half_l + 8.0, half_w - 3.5, trailer_length - 16.0, 2.0), Color(0.20, 0.45, 0.85, 1.0))

	# 6. Front aerodynamic bulkhead & refrigeration unit
	var front_bulkhead = Rect2(half_l - 7.0, -half_w + 1.0, 7.0, trailer_width - 2.0)
	draw_rect(front_bulkhead, Color(0.25, 0.28, 0.32, 1.0)) # Dark grey front bulkhead
	# Cooling aggregate unit
	draw_rect(Rect2(half_l - 6.0, -half_w + 5.0, 4.0, trailer_width - 10.0), Color(0.15, 0.18, 0.22, 1.0))

	# Front white corner position lights (LED)
	draw_circle(Vector2(half_l - 1.5, -half_w + 2.5), 1.5, Color(1.0, 1.0, 1.0, 1.0))
	draw_circle(Vector2(half_l - 1.5, half_w - 2.5), 1.5, Color(1.0, 1.0, 1.0, 1.0))

	# 7. Side amber marker lights (габаритные огни по бокам)
	var marker_xs = [half_l - 15.0, half_l - 45.0, -10.0, -half_l + 40.0, -half_l + 12.0]
	for mx in marker_xs:
		draw_rect(Rect2(mx - 1.0, -half_w - 0.5, 2.0, 1.5), Color(1.0, 0.68, 0.05, 1.0))
		draw_rect(Rect2(mx - 1.0, half_w - 1.0, 2.0, 1.5), Color(1.0, 0.68, 0.05, 1.0))

	# 8. Rear bumper, taillights, brake lights, indicators, triangles
	# Reflective bumper bar
	draw_rect(Rect2(-half_l, -half_w + 1.0, 2.5, trailer_width - 2.0), Color(0.90, 0.92, 0.95, 1.0))
	# Taillights (Red)
	draw_rect(Rect2(-half_l, -half_w + 2.0, 2.0, 5.0), Color(0.95, 0.12, 0.12, 1.0))
	draw_rect(Rect2(-half_l, half_w - 7.0, 2.0, 5.0), Color(0.95, 0.12, 0.12, 1.0))
	# Amber turn indicators
	draw_rect(Rect2(-half_l, -half_w + 7.5, 2.0, 2.5), Color(1.0, 0.65, 0.0, 1.0))
	draw_rect(Rect2(-half_l, half_w - 10.0, 2.0, 2.5), Color(1.0, 0.65, 0.0, 1.0))
	# European red reflective triangles
	draw_circle(Vector2(-half_l + 1.0, -half_w + 11.5), 1.2, Color(1.0, 0.05, 0.05, 1.0))
	draw_circle(Vector2(-half_l + 1.0, half_w - 11.5), 1.2, Color(1.0, 0.05, 0.05, 1.0))

	# 9. Kingpin hitch coupler indicator (at +42.5)
	draw_circle(Vector2(kingpin_offset, 0.0), 3.0, Color(0.2, 0.22, 0.26, 0.9))
	draw_circle(Vector2(kingpin_offset, 0.0), 1.5, Color(0.9, 0.92, 0.95, 1.0))
