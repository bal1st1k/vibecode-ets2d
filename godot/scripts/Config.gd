extends Node

# Single source of truth for map projection and world scale
# Base OpenStreetMap scale: 1 real meter = 1.25 world canvas units
const MAP_SCALE: float = 1.25

# Distance / time compression factor (ETS2 Moldova 1:8 scale, configurable)
# Multiplies world speed (units/s) so vehicle traverses compressed map at realistic game-time speed
var DISTANCE_COMPRESSION: float = 8.0

# Touch controls (auto-enabled on touchscreen devices, or toggled on desktop via F4 or env TOUCH_CONTROLS)
var touch_controls_enabled: bool = false

func _ready() -> void:
	if OS.has_environment("TOUCH_CONTROLS"):
		var env_t = OS.get_environment("TOUCH_CONTROLS")
		touch_controls_enabled = (env_t == "1" or env_t == "true")
	elif DisplayServer.is_touchscreen_available():
		touch_controls_enabled = true

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_F4:
			touch_controls_enabled = not touch_controls_enabled
			print("[Config] Touch controls toggled (F4): ", touch_controls_enabled)

# Conversion helpers
func get_world_scale() -> float:
	return MAP_SCALE

func real_meters_to_world(m: float) -> float:
	return m * MAP_SCALE

func world_to_real_meters(units: float) -> float:
	return units / MAP_SCALE

func world_speed_to_kmh(world_speed: float) -> float:
	return (abs(world_speed) / (MAP_SCALE * DISTANCE_COMPRESSION)) * 3.6

func kmh_to_world_speed(kmh: float) -> float:
	return (kmh / 3.6) * MAP_SCALE * DISTANCE_COMPRESSION
