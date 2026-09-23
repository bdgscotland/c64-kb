"""world.py: STARWATCH, the game's world. Edit this file, then `make gen`.

Everything the game knows is here: rooms, items, words, the action table,
the messages the engine itself prints, the pictures and the autopilot
script. tools/gen.py packs it into src/gen_world.h and src/gen_script.h and
plays the script through its model of the engine.

Text is upper case. Letters, digits, space and . , ' ! ? : - ( ) only.
"""

# ---- rooms --------------------------------------------------------------------
# key: (status-bar name, description, exits {dir: room}, dark, picture)
ROOMS = {
    "LANE": ("LANE", "YOU STAND ON A MUDDY LANE BESIDE A HIGH STONE WALL. AN IRON GATE "
             "IN THE WALL STANDS OPEN TO THE NORTH.", {"N": "GARDEN"}, False, "lane"),
    "GARDEN": ("GARDEN", "AN OVERGROWN GARDEN UNDER THE STARS. THE HOUSE IS NORTH, A SHED "
               "EAST AND A POND WEST.", {"S": "LANE", "N": "PORCH", "E": "SHED", "W": "POND"},
               False, "garden"),
    "SHED": ("SHED", "A DUSTY SHED THAT SMELLS OF TAR.", {"W": "GARDEN"}, False, "shed"),
    "POND": ("POND", "A STILL POND UNDER A WILLOW. THE MOON LIES ON THE WATER.",
             {"E": "GARDEN"}, False, "pond"),
    "PORCH": ("PORCH", "A CREAKING PORCH. THE FRONT DOOR IS NORTH.",
              {"S": "GARDEN", "N": "HALL"}, False, "porch"),
    "HALL": ("HALL", "A TALL HALL WITH A GRANDFATHER CLOCK. DOORS LEAD EAST AND WEST, "
             "STAIRS GO UP AND A STEP LEADS DOWN.",
             {"S": "PORCH", "E": "KITCHEN", "W": "LIBRARY", "U": "LANDING", "D": "CELLAR"},
             False, "hall"),
    "KITCHEN": ("KITCHEN", "A COLD KITCHEN. POTS HANG OVER AN IRON STOVE.", {"W": "HALL"},
                False, "kitchen"),
    "LIBRARY": ("LIBRARY", "BOOKS RISE TO THE CEILING ON EVERY WALL.", {"E": "HALL"},
                False, "library"),
    "CELLAR": ("CELLAR", "A DAMP CELLAR OF BARE STONE.", {"U": "HALL"}, True, "cellar"),
    "LANDING": ("LANDING", "A NARROW LANDING. A DOOR LEADS NORTH AND A HATCH IS SET IN THE "
                "CEILING.", {"D": "HALL", "N": "STUDY", "U": "TOWER"}, False, "landing"),
    "STUDY": ("STUDY", "THE ASTRONOMER'S STUDY. CHARTS OF THE SKY COVER THE WALLS.",
              {"S": "LANDING"}, False, "study"),
    "TOWER": ("TOWER", "THE DOME OF THE TOWER. A SLIT OPENS ON THE NIGHT, AND A GREAT "
              "TELESCOPE POINTS AT IT.", {"D": "LANDING"}, False, "tower"),
}
START = "LANE"

# ---- items --------------------------------------------------------------------
# key: (description, noun, start, flags, examine text or None)
# start: a room key, "CARRIED", "IN:<container>" or None (not in play yet).
# flags: P portable, C container, O container starts open, S scenery (not
# listed in LOOK; the room text mentions it).
ITEMS = {
    "NET": ("A FISHING NET", "NET", "SHED", "P", "A LONG-HANDLED NET, STIFF WITH MUD."),
    "LAMP": ("A BRASS LAMP", "LAMP", "IN:CHEST", "P", "IT HOLDS OIL BUT IT IS NOT LIT."),
    "LITLAMP": ("A LIT LAMP", "LAMP", None, "P", "IT BURNS WITH A STEADY FLAME."),
    "KEY": ("AN IRON KEY", "KEY", None, "P", None),
    "MATCHES": ("A BOX OF MATCHES", "MATCHES", "IN:DRAWER", "P", None),
    "LENS": ("A GLASS LENS", "LENS", "IN:CRATE", "P", "A HEAVY LENS, WRAPPED IN FELT."),
    "WINDER": ("A CLOCK WINDER", "WINDER", "IN:DESK", "P", None),
    "BOOK": ("A STAR ATLAS", "BOOK", "LIBRARY", "P",
             "A NOTE IN THE MARGIN SAYS: THE CLOCK KEEPS THE HATCH."),
    "CHEST": ("A WOODEN CHEST", "CHEST", "SHED", "C", None),
    "DRAWER": ("A KITCHEN DRAWER", "DRAWER", "KITCHEN", "C", None),
    "CRATE": ("A PACKING CRATE", "CRATE", "CELLAR", "C", None),
    "DESK": ("A WRITING DESK", "DESK", "STUDY", "C", None),
    "DOOR": ("A LOCKED DOOR", "DOOR", "PORCH", "", "IT IS STOUT OAK WITH AN IRON LOCK."),
    "OPENDOOR": ("AN OPEN DOOR", "DOOR", None, "", None),
    "POND": ("THE POND", "POND", "POND", "S", None),
    "CLOCK": ("THE CLOCK", "CLOCK", "HALL", "S",
              "ITS HANDS ARE STILL. THERE IS A SOCKET FOR A WINDER."),
    "SCOPE": ("THE TELESCOPE", "TELESCOPE", "TOWER", "S", None),
}
# How a container's contents are introduced, e.g. "IN THE CHEST: A BRASS LAMP."
INSIDE = {"CHEST": "IN THE CHEST", "DRAWER": "IN THE DRAWER", "CRATE": "IN THE CRATE",
          "DESK": "IN THE DESK"}
LIGHT_ITEM = "LITLAMP"          # a dark room is lit while this item is in reach
MAXLOAD = 5                     # items carried at once
MAXSCORE = 100

# ---- vocabulary -----------------------------------------------------------------
# Words match on their first four letters; a shorter word must match whole.
# Synonyms share an id. Directions are nouns 1 to 6, in this order.
DIRECTIONS = ["N", "S", "E", "W", "U", "D"]
VERBS = {
    "GO": ["GO", "WALK", "RUN", "CLIMB"],
    "GET": ["GET", "TAKE", "GRAB", "PICK"],
    "DROP": ["DROP", "DISCARD"],
    "LOOK": ["LOOK", "L", "EXAMINE", "X", "READ", "SEARCH", "INSPECT"],
    "INV": ["INVENTORY", "INV", "I"],
    "OPEN": ["OPEN"],
    "CLOSE": ["CLOSE", "SHUT"],
    "UNLOCK": ["UNLOCK"],
    "LIGHT": ["LIGHT", "IGNITE", "BURN"],
    "WIND": ["WIND", "TURN", "CRANK"],
    "PUT": ["PUT", "FIT", "INSERT", "PLACE"],
    "SCORE": ["SCORE"],
    "SAVE": ["SAVE"],
    "LOAD": ["LOAD", "RESTORE"],
    "QUIT": ["QUIT"],
    "HELP": ["HELP", "HINT"],
}
NOUNS = {
    "N": ["N", "NORTH"], "S": ["S", "SOUTH"], "E": ["E", "EAST"], "W": ["W", "WEST"],
    "U": ["U", "UP"], "D": ["D", "DOWN"],
    "NET": ["NET"], "LAMP": ["LAMP", "LANTERN"], "KEY": ["KEY"],
    "MATCHES": ["MATCHES", "MATCH"], "LENS": ["LENS", "GLASS"],
    "WINDER": ["WINDER", "CRANK"], "BOOK": ["BOOK", "ATLAS", "NOTE"],
    "CHEST": ["CHEST", "BOX"], "DRAWER": ["DRAWER"], "CRATE": ["CRATE"], "DESK": ["DESK"],
    "DOOR": ["DOOR"], "POND": ["POND", "WATER", "MUD"], "CLOCK": ["CLOCK"],
    "TELESCOPE": ["TELESCOPE", "SCOPE"], "HATCH": ["HATCH"],
}
NOISE = ["THE", "A", "AN", "AT", "TO", "IN", "INTO", "ON", "WITH"]   # skipped by the parser

# ---- the action table -------------------------------------------------------------
# Scanned top to bottom before the built-in verbs; the first row whose verb,
# noun and conditions all hold runs its commands and ends the turn. Verb None:
# an occurrence, run after every turn. At most four conditions and four commands.
# Conditions: AT room, CARRIED item, HERE item, REACH item (carried, here or
# in an open container here), FLAG f, NOTFLAG f, DARK.
# Commands: MSG text, GOTO room, LOOK, SETF f, SWAP item (item and the next
# item in ITEMS trade places), CARRY item, DESTROY item, SCORE n, WIN.
FLAGS = ["GOTKEY", "DOOROPEN", "HATCHOPEN", "LENSIN"]
ACTIONS = [
    ("GO", "N", ["AT PORCH", "NOTFLAG DOOROPEN"], ["MSG THE DOOR IS LOCKED."]),
    ("GO", "U", ["AT LANDING", "NOTFLAG HATCHOPEN"], ["MSG THE HATCH IS SHUT FAST."]),
    ("LOOK", "POND", ["AT POND", "NOTFLAG GOTKEY"],
     ["MSG SOMETHING GLINTS IN THE MUD, JUST OUT OF REACH."]),
    ("GET", "KEY", ["AT POND", "NOTFLAG GOTKEY", "CARRIED NET"],
     ["SETF GOTKEY", "CARRY KEY", "SCORE 10",
      "MSG YOU SWEEP THE NET THROUGH THE MUD AND LIFT OUT AN IRON KEY."]),
    ("GET", "KEY", ["AT POND", "NOTFLAG GOTKEY"], ["MSG IT IS OUT OF REACH."]),
    ("UNLOCK", "DOOR", ["AT PORCH", "NOTFLAG DOOROPEN", "CARRIED KEY"],
     ["SETF DOOROPEN", "SWAP DOOR", "SCORE 10", "MSG THE KEY TURNS AND THE DOOR SWINGS OPEN."]),
    ("UNLOCK", "DOOR", ["AT PORCH", "NOTFLAG DOOROPEN"], ["MSG YOU HAVE NO KEY."]),
    ("OPEN", "DOOR", ["AT PORCH", "NOTFLAG DOOROPEN"], ["MSG IT IS LOCKED."]),
    ("LIGHT", "LAMP", ["REACH LAMP", "CARRIED MATCHES"],
     ["SWAP LAMP", "SCORE 10", "MSG YOU STRIKE A MATCH. THE LAMP GLOWS."]),
    ("LIGHT", "LAMP", ["REACH LAMP"], ["MSG YOU HAVE NOTHING TO LIGHT IT WITH."]),
    ("LIGHT", "LAMP", ["REACH LITLAMP"], ["MSG IT IS ALREADY LIT."]),
    ("WIND", "CLOCK", ["AT HALL", "NOTFLAG HATCHOPEN", "CARRIED WINDER"],
     ["SETF HATCHOPEN", "SCORE 15",
      "MSG YOU WIND THE CLOCK. GEARS WHIRR, AND FAR ABOVE A HATCH GRINDS OPEN."]),
    ("WIND", "CLOCK", ["AT HALL", "NOTFLAG HATCHOPEN"], ["MSG YOU NEED A WINDER."]),
    ("WIND", "CLOCK", ["AT HALL"], ["MSG IT IS FULLY WOUND."]),
    ("PUT", "LENS", ["AT TOWER", "CARRIED LENS"],
     ["DESTROY LENS", "SETF LENSIN", "SCORE 15", "MSG THE LENS CLICKS INTO THE TELESCOPE."]),
    ("LOOK", "TELESCOPE", ["AT TOWER", "FLAG LENSIN"],
     ["SCORE 40", "MSG THROUGH THE GLASS THE COMET BLAZES, ITS TAIL ACROSS HALF THE SKY.",
      "WIN"]),
    ("LOOK", "TELESCOPE", ["AT TOWER"], ["MSG THE EYEPIECE IS EMPTY. IT NEEDS A LENS."]),
    ("LOOK", "HATCH", ["AT LANDING", "FLAG HATCHOPEN"], ["MSG IT STANDS OPEN."]),
    ("LOOK", "HATCH", ["AT LANDING"], ["MSG IT IS BOLTED FROM ABOVE BY SOME MECHANISM."]),
    (None, None, ["AT CELLAR", "DARK"], ["MSG SOMETHING SCUTTLES IN THE DARK."]),
]

# ---- what the engine itself prints --------------------------------------------------
MESSAGES = {
    "DARK": "IT IS TOO DARK TO SEE.",
    "DARKNAME": "DARKNESS",
    "SEE": "YOU CAN SEE ",
    "EXITS": "EXITS:",
    "NOEXITS": "NO EXITS.",
    "CARRYING": "YOU ARE CARRYING ",
    "NOTHING": "NOTHING",
    "EMPTY": "IT IS EMPTY.",
    "CLOSED": "IT IS CLOSED.",
    "UNKNOWN": "I DON'T KNOW THE WORD ",
    "PARDON": "PARDON?",
    "NOWAY": "YOU CAN'T GO THAT WAY.",
    "WHICHWAY": "WHICH WAY?",
    "TAKEN": "TAKEN.",
    "DROPPED": "DROPPED.",
    "HAVEIT": "YOU ALREADY HAVE IT.",
    "NOTHERE": "YOU SEE NO SUCH THING HERE.",
    "NOTHAVE": "YOU ARE NOT CARRYING IT.",
    "FULL": "YOUR HANDS ARE FULL.",
    "FIXED": "IT WON'T BUDGE.",
    "OPENED": "OPENED.",
    "CLOSEDOK": "CLOSED.",
    "ISOPEN": "IT IS ALREADY OPEN.",
    "ISSHUT": "IT IS ALREADY CLOSED.",
    "NOTOPEN": "YOU CAN'T OPEN THAT.",
    "NOTHINGSPECIAL": "YOU SEE NOTHING SPECIAL.",
    "CANT": "YOU CAN'T DO THAT.",
    "WHAT": "WHAT?",
    "SCORED": "YOU HAVE SCORED ",
    "OUTOF": " OUT OF ",
    "IN": " IN ",
    "TURNS": " TURNS.",
    "WON": "YOU HAVE SEEN THE COMET. THE NIGHT IS YOURS!",
    "QUITS": "YOU LEAVE THE HOUSE TO ITS DREAMS.",
    "RANK0": "RANK: STARGAZER.",
    "RANK1": "RANK: CLOUD WATCHER.",
    "AGAIN": "PRESS RETURN TO PLAY AGAIN.",
    "HELP": "TRY VERBS LIKE GO, GET, DROP, OPEN, LOOK, LIGHT, INVENTORY, SCORE, SAVE AND LOAD.",
    "SAVED": "GAME SAVED ",
    "LOADED": "GAME LOADED ",
    "NOSAVE": "NO SAVED GAME ",
    "BADSAVE": "THE SAVED GAME IS DAMAGED ",
    "DISKFAIL": "THE DISK DID NOT ANSWER ",
    "INTRO": "STARWATCH. TONIGHT THE COMET PASSES, AND THE OLD ASTRONOMER'S TOWER "
             "HAS THE ONLY TELESCOPE FOR MILES.",
}

# ---- pictures --------------------------------------------------------------------------
# The strip is 40 x 7 cells of multicolour characters. A tile is a glyph of
# 4 x 8 double-wide pixels: '.' $D021 (black), 'a' $D022 (grey), 'b' $D023
# (brown), 'c' the cell's own colour (0-7), given with the tile where it is used.
GLYPHS = {
    "sky": ["...."] * 8,
    "star": ["....", "..c.", "....", "....", "....", "....", "....", "...."],
    "star2": ["....", "....", "....", "....", "....", ".c..", "....", "...."],
    "solid": ["cccc"] * 8,
    "stone": ["aaa.", "aaa.", "aaa.", "....", "a.aa", "a.aa", "a.aa", "...."],
    "plank": ["bbbb", "bbbb", "bbbb", "....", "bbbb", "bbbb", "bbbb", "...."],
    "wood": ["bbb."] * 8,
    "earth": ["bbab", "bbbb", "abbb", "bbbb", "bbba", "bbbb", "babb", "bbbb"],
    "grass": ["..c.", ".c.c", "cccc", "cccc", "cbcc", "cccc", "ccbc", "cccc"],
    "water": ["cccc", "acca", "cccc", "cc.c", "cccc", "accc", "cccc", "c.cc"],
    "leaves": [".cc.", "cccc", "cc.c", "cccc", ".ccc", "cccc", "c.cc", ".cc."],
    "window": ["bbbb", "bccc", "bccc", "bbbb", "bccc", "bccc", "bccc", "bbbb"],
    "bars": ["c.c.", "c.c.", "c.c.", "c.c.", "c.c.", "c.c.", "c.c.", "c.c."],
    "knob": ["bbbb", "bbbb", "bbbb", "bbcb", "bbbb", "bbbb", "bbbb", "bbbb"],
    "books": ["cacb", "cacb", "cacb", "cacb", "cacb", "cacb", "cacb", "bbbb"],
    "slopel": ["...a", "...a", "..aa", "..aa", ".aaa", ".aaa", "aaaa", "aaaa"],
    "sloper": ["a...", "a...", "aa..", "aa..", "aaa.", "aaa.", "aaaa", "aaaa"],
    "net": ["a.a.", ".a.a", "a.a.", ".a.a", "a.a.", ".a.a", "a.a.", ".a.a"],
    "face": [".cc.", "cccc", "cbcc", "cbbc", "cccc", ".cc.", "..b.", "..b."],
    "eyes": ["....", "....", "c.c.", "....", "....", "....", "....", "...."],
    "tube": ["...c", "..cc", ".cc.", "cc..", "c...", "....", "....", "...."],
    "box": ["bbbb", "b..b", "bbbb", "bcbb", "bbbb", "bbbb", "bbbb", "...."],
}
BLACK, WHITE, RED, CYAN, PURPLE, GREEN, BLUE, YELLOW = range(8)


def sky(p):
    """Night sky with a fixed star field."""
    p.fill(0, 0, 39, 6, "sky")
    for i, (x, y) in enumerate([(3, 0), (11, 1), (17, 0), (24, 2), (30, 0), (36, 1),
                                (7, 2), (20, 1), (33, 3), (1, 3), (27, 1), (14, 3)]):
        p.put(x, y, "star" if i % 2 else "star2", WHITE)


def inside(p, wall="stone", floor="plank"):
    p.fill(0, 0, 39, 5, wall)
    p.fill(0, 6, 39, 6, floor)


def pic_lane(p):
    sky(p); p.put(4, 1, "solid", WHITE)
    p.fill(8, 2, 39, 5, "stone"); p.fill(20, 2, 23, 5, "bars", BLUE)
    p.fill(0, 6, 39, 6, "earth")


def pic_garden(p):
    sky(p); p.fill(0, 5, 39, 6, "grass", GREEN)
    p.fill(2, 1, 7, 3, "leaves", GREEN); p.fill(4, 4, 5, 5, "wood")
    p.fill(15, 2, 27, 4, "stone"); p.put(14, 2, "slopel"); p.put(28, 2, "sloper")
    p.put(18, 3, "window", YELLOW); p.put(24, 3, "window", YELLOW)
    p.fill(33, 3, 37, 4, "plank"); p.put(35, 3, "window", YELLOW)


def pic_shed(p):
    inside(p, "wood", "earth")
    p.fill(15, 4, 23, 5, "box"); p.put(19, 4, "knob", YELLOW)
    p.fill(30, 1, 33, 3, "net")


def pic_pond(p):
    sky(p); p.put(30, 1, "solid", WHITE)
    p.fill(0, 4, 39, 6, "water", BLUE); p.put(30, 5, "solid", WHITE)
    p.fill(1, 0, 8, 3, "leaves", GREEN); p.fill(4, 3, 5, 3, "wood")


def pic_porch(p):
    inside(p, "stone", "plank")
    p.fill(16, 1, 22, 5, "wood"); p.put(21, 3, "knob", YELLOW)
    p.put(8, 2, "window", YELLOW); p.put(30, 2, "window", YELLOW)


def pic_hall(p):
    inside(p)
    p.fill(6, 0, 9, 5, "wood"); p.fill(7, 1, 8, 1, "face", WHITE)
    for i in range(5):
        p.fill(26 + 2 * i, 5 - i, 39, 5 - i, "plank")
    p.fill(15, 2, 18, 5, "wood")


def pic_kitchen(p):
    inside(p, "stone", "earth")
    p.fill(4, 3, 12, 5, "solid", RED); p.fill(5, 1, 6, 2, "solid", BLACK)
    p.fill(22, 3, 33, 5, "wood"); p.put(27, 4, "knob", YELLOW)
    p.put(16, 0, "bars", WHITE); p.put(18, 0, "bars", WHITE)


def pic_library(p):
    inside(p, "wood", "plank")
    colours = [RED, GREEN, YELLOW, BLUE, PURPLE, CYAN]
    for y in (0, 2, 4):
        for x in range(1, 39):
            if x % 7:
                p.put(x, y, "books", colours[(x + y) % 6])


def pic_cellar(p):
    inside(p, "stone", "earth")
    p.fill(18, 3, 25, 5, "box"); p.put(21, 4, "knob", YELLOW)
    p.fill(0, 0, 3, 5, "slopel")


def pic_dark(p):
    p.fill(0, 0, 39, 6, "sky")
    p.put(12, 3, "eyes", YELLOW); p.put(29, 4, "eyes", YELLOW)


def pic_landing(p):
    inside(p, "wood", "plank")
    p.fill(0, 4, 39, 4, "bars", WHITE)
    p.fill(17, 0, 22, 0, "box"); p.fill(30, 1, 34, 5, "wood")


def pic_study(p):
    inside(p, "wood", "plank")
    p.fill(4, 1, 11, 3, "sky"); p.put(6, 2, "star", WHITE); p.put(9, 1, "star2", WHITE)
    p.fill(20, 4, 33, 5, "box"); p.put(26, 4, "knob", YELLOW)
    p.put(22, 3, "solid", YELLOW)


def pic_tower(p):
    p.fill(0, 0, 39, 6, "stone")
    p.fill(14, 0, 25, 4, "sky")
    p.put(16, 1, "star", WHITE); p.put(22, 0, "star2", WHITE); p.put(19, 3, "star", WHITE)
    for i in range(4):
        p.put(18 + i, 5 - i, "tube", WHITE)
    p.fill(0, 6, 39, 6, "plank")


PICTURES = {"lane": pic_lane, "garden": pic_garden, "shed": pic_shed, "pond": pic_pond,
            "porch": pic_porch, "hall": pic_hall, "kitchen": pic_kitchen,
            "library": pic_library, "cellar": pic_cellar, "landing": pic_landing,
            "study": pic_study, "tower": pic_tower, "dark": pic_dark}
DARK_PICTURE = "dark"

# ---- the autopilot ------------------------------------------------------------------------
# Typed through the KERNAL keyboard queue, up to ten bytes a frame. The shot
# plays all of it with a copy of the release disk in drive 8. make disktest
# splits it at the SAVE: part one ends with the SAVE; part two starts at the
# LOAD after a cold reset (DISK_SPLIT).
SCRIPT = [
    "XYZZY", "N", "E", "OPEN CHEST", "TAKE LANTERN", "GET NET", "W", "W",
    "EXAMINE POND", "GET KEY", "DROP NET", "E", "N", "N", "UNLOCK DOOR", "N",
    "SAVE", "E", "OPEN DRAWER", "GET MATCHES", "DROP LAMP", "LOAD",
    "E", "OPEN DRAWER", "GET MATCHES", "W", "D", "LIGHT LAMP", "OPEN CRATE", "GET LENS", "U",
    "U", "U", "N", "OPEN DESK", "GET WINDER", "S", "D", "WIND CLOCK", "U", "U",
    "PUT LENS IN TELESCOPE", "LOOK AT TELESCOPE",
]
