// The dev harness's fixture data. Entity states, devices, areas, recorded history
// and the bound subentries live in sample-data.json, which the dev server
// (scripts/harness_server.py) also loads into the Home Assistant that
// answers previews.
//
// The states cover every hub card and editor path: a fraction-scale sensor
// (sensor.wash_remaining) for sourced segment weights, switchboard tiles of
// both kinds (a running script is highlighted), pictures the phone may
// (switch.fountain) and may not (scene.movie) fetch, and covers and locks
// that use their own state words.

import data from "./sample-data.json" with { type: "json" };

/** When the harness loaded: each state last changed a fixed while before
 * it, so "Changed 12 minutes ago" reads the same on every load. */
const LOADED = Date.now();

export const STATES = Object.fromEntries(
  Object.entries(data.states).map(([id, state], i) => [
    id,
    { ...state, last_changed: new Date(LOADED - (12 + (i % 6) * 9) * 60_000).toISOString() },
  ]),
);

/** Bound subentries of the default account. */
export const BOUND = data.bound;

/** The canned aivi/suggest answers, by template slug (the activity
 * progress template shares the widget's). */
export const SUGGESTIONS = data.suggestions;

export const AIVI_WIDGETS = [
  { slug: "laundry", name: "Laundry", template: "progress" },
  { slug: "frontdoor", name: "Front door", template: "status" },
  { slug: "batteries", name: "Home batteries", template: "battery" },
  { slug: "thermostat", name: "Thermostat", template: "gauge" },
  { slug: "bins", name: "Bin day", template: "countdown" },
  { slug: "livingroom", name: "Living room", template: "switchboard" },
  // A template this build doesn't know: the hub's "not supported yet"
  // card is a default harness state.
  { slug: "weather", name: "Weather", template: "forecast" },
];

// The budget, trend, prices and energy widgets and a list, listed with
// ?more=1 (the default listing stays the one the hub tests count).
export const MORE_WIDGETS = [
  { slug: "spending", name: "Spending", template: "budget" },
  { slug: "indoor", name: "Indoor", template: "trend" },
  { slug: "electricity", name: "Electricity", template: "prices" },
  { slug: "energy", name: "Energy", template: "energy" },
  { slug: "home", name: "Home", template: "list" },
  { slug: "car", name: "Car", template: "showcase" },
  { slug: "carremote", name: "Car remote", template: "remote" },
  { slug: "garagedoor", name: "Garage door", template: "remote" },
];

// ?more=1 also binds two remotes. The car: its picture, the charge as the
// reading, the range as a stat, its lock and climate as buttons, and when
// the charge last reported. The garage door: no picture (its icon stands
// in), the door's state as the reading, the door and the porch light as
// buttons.
// ?more=1 also lists the Robot vacuum Live Activity (a remote) and binds
// it: its state word, its battery as the reading, how much is cleaned as
// the bar, and two buttons.
export const MORE_ACTIVITIES = [{ slug: "vacuum", name: "Robot vacuum", template: "remote" }];

export const REMOTE_ACTIVITY_BINDING = {
  subentry_id: "a-vacuum",
  slug: "vacuum",
  name: "Robot vacuum",
  template: "remote",
  active: "input_boolean.front_door",
  bindings: {
    value: "sensor.vacuum_battery",
    unit: "%",
    state: "sensor.vacuum_status",
    state__color: "green",
    actions: ["script.vacuum_pause", "script.vacuum_dock"],
    actions__options: {
      "script.vacuum_pause": { label: "Pause", icon: "pause.fill" },
      "script.vacuum_dock": { label: "Dock", icon: "house.fill" },
    },
    progress: "sensor.vacuum_cleaned",
    icon: "fan.fill",
  },
};

export const REMOTE_BINDINGS = [
  {
    subentry_id: "w-carremote",
    slug: "carremote",
    name: "Car remote",
    template: "remote",
    bindings: {
      image: "https://pictures.example.com/car.png",
      image_alt: "The car from the side",
      value: "sensor.my_car_charge",
      stats: ["sensor.my_car_range"],
      stats__options: { "sensor.my_car_range": { label: "Range" } },
      actions: ["lock.my_car", "climate.my_car"],
      actions__options: {
        "lock.my_car": { label: "Lock" },
        "climate.my_car": { label: "Climate" },
      },
      reported_at: "sensor.my_car_charge",
      icon: "car.fill",
      accent: "blue",
    },
  },
  {
    subentry_id: "w-garagedoor",
    slug: "garagedoor",
    name: "Garage door",
    template: "remote",
    bindings: {
      value: "cover.garage",
      actions: ["cover.garage", "light.porch"],
      actions__options: { "cover.garage": { label: "Door" } },
      icon: "door.garage.closed",
      accent: "orange",
    },
  },
];

// ?more=1 also binds the Car showcase: a picture of the car, its doors as
// the state mark, three readings (the charge with a gauge up to 100) and
// when the charge last reported.
export const SHOWCASE_BINDING = {
  subentry_id: "w-car",
  slug: "car",
  name: "Car",
  template: "showcase",
  bindings: {
    image: "https://pictures.example.com/car.png",
    image_alt: "The car from the side",
    state: "sensor.my_car_doors",
    state__color: "green",
    state_icon: "lock.fill",
    stats: ["sensor.my_car_charge", "sensor.my_car_range", "sensor.my_car_odometer"],
    stats__options: {
      "sensor.my_car_charge": { label: "Charge", icon: "bolt.fill", max: "100" },
      "sensor.my_car_range": { label: "Range" },
      "sensor.my_car_odometer": { label: "Odometer" },
    },
    reported_at: "sensor.my_car_charge",
    badge: "https://pictures.example.com/badge.png",
    icon: "car.fill",
    accent: "blue",
  },
};

// ?more=1 also binds the Home list on the mock account: four rows with
// their own labels, three with an icon, so its editor opens on a preview
// with every part of a row in it.
export const LIST_BINDING = {
  subentry_id: "w-list",
  slug: "home",
  name: "Home",
  template: "list",
  bindings: {
    rows: ["sensor.living_temp", "lock.front_door", "sensor.humidity", "cover.garage"],
    rows__options: {
      "sensor.living_temp": { label: "Living room", icon: "thermometer.medium", color: "orange" },
      "lock.front_door": { label: "Front door", icon: "lock.fill" },
      "sensor.humidity": { label: "Humidity" },
      "cover.garage": { label: "Garage", icon: "door.garage.closed" },
    },
  },
};

// Live Activities are defined in the Aivi app and only bound here:
// "washer" is bound (BOUND), "grill" is not.
export const AIVI_ACTIVITIES = [
  { slug: "washer", name: "Washer", template: "progress" },
  { slug: "grill", name: "Grill", template: "monitor" },
];

// The subset of hass.entities / hass.devices the panel consumes (the
// tap_url device deep-link chips in aivi-field-row.ts, the row label
// placeholders). The car's entities are named the has_entity_name way,
// as the dev server registers them (sample-data.json's devices).
export const ENTITIES = {
  "input_boolean.front_door": { device_id: "dev-door" },
  "input_number.washer_progress": { device_id: "dev-washer" },
  "input_text.washer_state": { device_id: "dev-washer" },
  "sensor.vacuum_battery": { device_id: "dev-vacuum" },
  ...Object.fromEntries(
    Object.entries(data.devices).flatMap(([device_id, device]) =>
      Object.entries(device.entities).map(([id, name]) => [
        id,
        { device_id, has_entity_name: true, ...(name ? { name } : {}) },
      ]),
    ),
  ),
};

export const DEVICES = {
  "dev-door": { name: "Front door sensor" },
  "dev-washer": { name: "Washer" },
  "dev-vacuum": { name: "Robot vacuum", name_by_user: "Dusty" },
  ...Object.fromEntries(
    Object.entries(data.devices).map(([id, device]) => [id, { name: device.name }]),
  ),
};

// ?switchboard=1 binds the Living room switchboard on the mock account,
// and these are its recent presses (aivi/inputs/subscribe), newest first,
// one of each outcome. Times are minutes before now.
export const SWITCHBOARD_BINDING = {
  subentry_id: "w-sb",
  slug: "livingroom",
  name: "Living room",
  template: "switchboard",
  bindings: {
    actions: ["light.porch", "switch.fountain", "scene.movie", "cover.garage"],
  },
};

// A push's request as it goes over the wire (PushRow.request).
const activity = (slug, state, content) => ({
  method: "PATCH",
  path: `/activities/${slug}`,
  body: { state, content: { template: "progress", ...content } },
});
const widget = (slug, template, content) => ({
  method: "PATCH",
  path: `/widgets/${slug}`,
  body: { content: { template, ...content } },
});

// ?waiting=1: the sensor the Washer's progress follows (it reads
// unknown, sample-data.json), and the pushes that leaves in the log,
// newest first: content that waits on it, and before that a change the
// throttle held back (`heldFor`: the activity's interval, in seconds).
export const WAITING_PROGRESS = "sensor.dryer_progress";
export const WAITING_PUSHES = [
  {
    minutes: 0.2,
    kind: "activity",
    slug: "washer",
    outcome: "waiting",
    status: "waiting",
    count: 4,
    request: null,
    waiting: {
      field: "progress",
      fields: ["progress"],
      entity_id: WAITING_PROGRESS,
      reading: "unknown",
    },
  },
  {
    minutes: 0.4,
    kind: "activity",
    slug: "washer",
    outcome: "held",
    status: "ok",
    count: 2,
    heldFor: 60,
    request: activity("washer", "ONGOING", {
      progress: { value: 0.64 },
      header_left: { value: "Rinsing" },
      compact_value: { value: "Rinsing", color: "green" },
    }),
  },
];

// Pushes to Aivi (aivi/inputs/subscribe), newest first, one of each
// outcome, for whatever of these the account binds: the Front door
// widget, the Washer Live Activity and (with ?switchboard=1) the Living
// room switchboard. Times are minutes before now.
export const PUSHES = [
  {
    minutes: 0.5,
    kind: "widget",
    slug: "frontdoor",
    outcome: "delivered",
    status: "ok",
    duration_ms: 212,
    request: widget("frontdoor", "status", { state: { value: "Open" }, accent: "red" }),
  },
  {
    minutes: 2,
    kind: "activity",
    slug: "washer",
    outcome: "unchanged",
    status: "ok",
    count: 12,
    request: activity("washer", "ONGOING", {
      progress: { value: 0.62 },
      header_left: { value: "Rinsing" },
      compact_value: { value: "Rinsing", color: "green" },
    }),
  },
  {
    minutes: 4,
    kind: "widget",
    slug: "livingroom",
    outcome: "delivered",
    status: "ok",
    duration_ms: 341,
    request: widget("livingroom", "switchboard", {
      actions: [
        { id: "light_porch", label: "Porch light", toggle: { value: true } },
        { id: "scene_movie", label: "Movie night" },
      ],
    }),
  },
  {
    minutes: 5,
    kind: "widget",
    slug: "frontdoor",
    outcome: "retrying",
    status: "retrying",
    error: "Cannot reach Aivi: Cannot connect to host api.getaivi.app",
    count: 3,
    request: widget("frontdoor", "status", { state: { value: "Closed" }, accent: "red" }),
  },
  {
    minutes: 8,
    kind: "activity",
    slug: "washer",
    outcome: "failed",
    status: "rejected",
    error: "Aivi rejected the content: progress.value: Input should be less than or equal to 1",
    request: activity("washer", "ONGOING", {
      progress: { value: 1.62 },
      header_left: { value: "Rinsing" },
      compact_value: { value: "Rinsing", color: "green" },
    }),
  },
  {
    minutes: 14,
    kind: "widget",
    slug: "frontdoor",
    outcome: "delivered",
    status: "ok",
    duration_ms: 198,
    request: widget("frontdoor", "status", { state: { value: "Closed" }, accent: "red" }),
  },
];

export const PRESSES = [
  {
    minutes: 1,
    event_type: "toggle_on",
    entity_id: "light.porch",
    label: "Porch light",
    value: true,
    outcome: "played",
  },
  {
    minutes: 3,
    event_type: "pressed",
    entity_id: "scene.movie",
    label: "Movie night",
    value: null,
    outcome: "failed",
    error: "Unable to reach the device",
  },
  {
    minutes: 6,
    event_type: "toggle_off",
    entity_id: "switch.fountain",
    label: "Fountain",
    value: false,
    outcome: "expired",
  },
  {
    minutes: 9,
    event_type: "pressed",
    entity_id: null,
    label: null,
    value: null,
    outcome: "not_bound",
  },
  {
    minutes: 12,
    event_type: "toggle_on",
    entity_id: "cover.garage",
    label: "Garage",
    value: true,
    outcome: "played",
  },
];
