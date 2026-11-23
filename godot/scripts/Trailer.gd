extends Node2D

# 2D Top-Down European Semi-Trailer (13.6m Standard Curtainsider)
@export var trailer_length: float = 136.0 # ~13.6 m standard Euro trailer
@export var trailer_width: float = 28.0   # ~2.5 m width
@export var kingpin_offset: float = 52.5  # distance from center to kingpin hitch (105 * 0.5)

func _ready() -> void:
	z_index = 0
	queue_redraw()

func _draw() -> void:
	var half_l = trailer_length * 0.5
	var half_w = trailer_width * 0.5

	# 1. Soft drop shadow
	draw_rect(Rect2(-half_l + 3.0, -half_w + 3.0, trailer_length, trailer_width), Color(0.0, 0.0, 0.0, 0.32))

	# 2. Steel chassis beams & undercarriage
	draw_rect(Rect2(-half_l + 8.0, -half_w + 3.0, trailer_length - 16.0, trailer_width - 6.0), Color(0.10, 0.12, 0.15, 1.0))

	# 3. Side underrun protection bars & landing gear
	# Underrun side rails with yellow safety markers
	draw_rect(Rect2(-half_l + 32.0, -half_w - 1.0, 38.0, 2.0), Color(0.85, 0.75, 0.15, 0.95))
	draw_rect(Rect2(-half_l + 32.0, half_w - 1.0, 38.0, 2.0), Color(0.85, 0.75, 0.15, 0.95))
	# Landing gear support legs
	draw_rect(Rect2(half_l - 42.0, -half_w - 1.0, 4.0, trailer_width + 2.0), Color(0.18, 0.20, 0.24, 1.0))

	# 4. Triple-axle rear bogie (6 wheels: 3 on left, 3 on right)
	# Bogie center is at -52.5, matching KINGPIN_TO_AXLE = 105.0 from kingpin at +52.5
	var wheel_w = 14.0
	var wheel_h = 6.0
	var axle_x = [-62.5, -52.5, -42.5]
	for ax in axle_x:
		# Left wheels
		draw_rect(Rect2(ax - wheel_w * 0.5, -half_w - 2.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.10, 1.0))
		# Right wheels
		draw_rect(Rect2(ax - wheel_w * 0.5, half_w - 4.0, wheel_w, wheel_h), Color(0.08, 0.08, 0.10, 1.0))

	# 5. Main container / curtainsider box
	var box_rect = Rect2(-half_l + 6.0, -half_w + 1.0, trailer_length - 10.0, trailer_width - 2.0)
	draw_rect(box_rect, Color(0.15, 0.19, 0.25, 1.0)) # Dark slate curtainsider

	# 6. Tarpaulin side curtain & livery stripe (Neon Lime accent matching web version)
	var curtain_rect = Rect2(-half_l + 10.0, -half_w + 2.0, trailer_length - 18.0, trailer_width - 4.0)
	draw_rect(curtain_rect, Color(0.20, 0.26, 0.34, 1.0))
	# Dynamic center stripe
	draw_rect(Rect2(-half_l + 10.0, -1.5, trailer_length - 18.0, 3.0), Color(0.83, 1.0, 0.26, 1.0))

	# 7. Front aerodynamic bulkhead wall (connecting with truck cab)
	draw_rect(Rect2(half_l - 10.0, -half_w + 1.0, 6.0, trailer_width - 2.0), Color(0.08, 0.12, 0.18, 1.0))

	# 8. Rear bumper, license plate, mudflaps & taillights
	draw_rect(Rect2(-half_l + 2.0, -half_w + 1.0, 4.0, trailer_width - 2.0), Color(0.80, 0.82, 0.85, 1.0)) # Reflective white bumper
	# Rear taillights (Red)
	draw_rect(Rect2(-half_l + 3.0, -half_w + 2.0, 2.0, 6.0), Color(0.95, 0.15, 0.15, 1.0))
	draw_rect(Rect2(-half_l + 3.0, half_w - 8.0, 2.0, 6.0), Color(0.95, 0.15, 0.15, 1.0))
	# Amber turn indicators
	draw_rect(Rect2(-half_l + 3.0, -half_w + 8.0, 2.0, 3.0), Color(0.96, 0.62, 0.07, 1.0))
	draw_rect(Rect2(-half_l + 3.0, half_w - 11.0, 2.0, 3.0), Color(0.96, 0.62, 0.07, 1.0))

	# 9. Kingpin hitch coupler indicator (at +52.5)
	draw_circle(Vector2(kingpin_offset, 0.0), 3.5, Color(0.80, 0.85, 0.90, 0.9))
