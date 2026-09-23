// autopilot.h: the scripted joystick for AUTOPILOT builds (c64-kb
// headless-verify's synthetic port byte). { frames, port byte }, active
// low as $DC00 reads it. Every frame from power-on reads the next byte.
#define AP_IDLE  0xff
#define AP_FIRE  (0xff ^ JOY_FIRE)
#define AP_RIGHT (0xff ^ JOY_RIGHT)
#define AP_LEFT  (0xff ^ JOY_LEFT)
#define AP_RJUMP (0xff ^ JOY_RIGHT ^ JOY_FIRE)

static const char script[][2] = {
    { 20, AP_IDLE },                // the title
    {  1, AP_FIRE },                // fire: a new game
    {  4, AP_IDLE },
    {100, AP_RIGHT },               // over the coins and the hill
    { 31, AP_IDLE },                // the walker comes closer
    {  1, AP_FIRE },                // a jump straight up: down onto it
    { 88, AP_IDLE },                // the stomp, the bounce
    { 59, AP_RIGHT },               // to the pit's edge
    {  1, AP_RJUMP },               // over it
    {116, AP_RIGHT },               // the 1-in-2 hill, under the ledge
    {  1, AP_RJUMP },               // up onto the ledge: two coins
    {150, AP_RIGHT },               // off its end, into the hopper: a life lost
    { 44, AP_IDLE },                // the respawn, back on the hill; the camera scrolls back
    { 86, AP_RIGHT },
    {  1, AP_RJUMP },               // over the hopper
    { 60, AP_RIGHT },
    {  1, AP_RJUMP },               // over the second pit
    { 60, AP_RIGHT },               // into the brick wall: it stops the player at x 716
};
#define SCRIPT_STEPS (sizeof(script) / sizeof(script[0]))
