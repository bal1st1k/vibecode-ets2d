extends Control

# Visual pause button (||) in top right safe area
func _draw() -> void:
	var r = min(size.x, size.y) * 0.46
	var center = size * 0.5

	draw_circle(center + Vector2(1, 1), r, Color(0, 0, 0, 0.3))
	draw_circle(center, r, Color(0.12, 0.16, 0.20, 0.85))
	draw_arc(center, r, 0, TAU, 32, Color(0.45, 0.52, 0.60, 0.8), 2.0)

	# Two vertical pause bars
	var bar_w = 4.0
	var bar_h = 16.0
	draw_rect(Rect2(center.x - 7.0, center.y - bar_h * 0.5, bar_w, bar_h), Color(0.95, 0.98, 1.0, 0.95))
	draw_rect(Rect2(center.x + 3.0, center.y - bar_h * 0.5, bar_w, bar_h), Color(0.95, 0.98, 1.0, 0.95))
