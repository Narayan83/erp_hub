MENUS: list[tuple[str, str, str | None, int]] = [
    ("front_desk", "Front Desk", None, 12),
    ("billing", "Billing", None, 18),
    ("staff", "Staff", None, 30),
    ("room_check_in", "Room Check-In", "front_desk", 1),
    ("room_booking", "Room Booking", "front_desk", 2),
    ("final_bill", "Final Bill", "billing", 1),
    ("room_type_master", "Room Type Master", "masters", 20),
    ("room_master", "Room Master", "masters", 21),
    ("staff_master", "Staff Master", "staff", 1),
]
LODGE_MENUS = MENUS
