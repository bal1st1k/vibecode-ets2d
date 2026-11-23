extends Node

# Single source of truth for map projection and world scale
# Base OpenStreetMap scale: 1 real meter = 1.25 world canvas units
const MAP_SCALE: float = 1.25

# Distance / time compression factor (ETS2 Moldova 1:8 scale, configurable)
# Multiplies world speed (units/s) so vehicle traverses compressed map at realistic game-time speed
var DISTANCE_COMPRESSION: float = 8.0

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
