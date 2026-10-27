// Approximate icons for the preview. A browser can't draw Apple's SF
// Symbols and their license rules out shipping them, so the preview draws
// the closest Material Design Icon instead, through Home Assistant's own
// <ha-icon> (which loads each icon on demand: only names live here, never
// paths). The device still draws Apple's symbol.
//
// The table covers the symbols a home uses: the shortlist the AI helper
// picks from (the SF Symbols "home" category and the common ones), plus
// everyday names. Every MDI name is checked against the real set by
// tests/symbol-icons.test.ts.

/** SF Symbol -> MDI name. Where MDI has an outline, that is the value: a
 * plain SF Symbol is an outline, and its `.fill` variant drops the
 * suffix (lock -> lock-outline, lock.fill -> lock). */
const MDI: Readonly<Record<string, string>> = {
  // climate and air
  "air.conditioner.horizontal": "air-conditioner",
  "air.conditioner.vertical": "air-conditioner",
  "air.purifier": "air-purifier",
  dehumidifier: "air-humidifier-off",
  fan: "fan",
  "fan.and.light.ceiling": "ceiling-fan-light",
  "fan.ceiling": "ceiling-fan",
  "fan.desk": "fan",
  "fan.floor": "fan",
  "fan.oscillation": "fan",
  fireplace: "fireplace",
  flame: "fire",
  "heater.vertical": "radiator",
  humidifier: "air-humidifier",
  "humidifier.and.droplets": "air-humidifier",
  "humidifier.and.ellipsis": "air-humidifier",
  humidity: "water-percent",
  snowflake: "snowflake",
  thermometer: "thermometer",
  "thermometer.and.ellipsis": "thermometer",
  "thermometer.high": "thermometer-high",
  "thermometer.low": "thermometer-low",
  "thermometer.medium": "thermometer",
  "thermometer.snowflake": "snowflake-thermometer",
  "thermometer.sun": "sun-thermometer-outline",
  "carbon.dioxide.cloud": "molecule-co2",
  "carbon.monoxide.cloud": "molecule-co",

  // lights and switches
  chandelier: "chandelier",
  "lamp.ceiling": "ceiling-light-outline",
  "lamp.desk": "desk-lamp",
  "lamp.floor": "floor-lamp-outline",
  "lamp.table": "lamp-outline",
  "light.beacon.max": "alarm-light-outline",
  "light.beacon.min": "alarm-light-outline",
  "light.cylindrical.ceiling": "ceiling-light-outline",
  "light.panel": "wall-sconce-flat-outline",
  "light.recessed": "light-recessed",
  "light.recessed.3": "light-recessed",
  "light.ribbon": "led-strip-variant",
  "light.strip.2": "led-strip",
  lightbulb: "lightbulb-outline",
  "lightbulb.2": "lightbulb-multiple-outline",
  "lightbulb.led": "lightbulb-variant-outline",
  "lightbulb.led.wide": "lightbulb-variant-outline",
  "lightbulb.max": "lightbulb-on-outline",
  "lightbulb.min": "lightbulb-on-10",
  "lightswitch.off": "light-switch-off",
  "lightswitch.on": "light-switch",
  "button.programmable": "gesture-tap-button",
  "switch.programmable": "toggle-switch-variant",

  // power and energy
  "battery.0percent": "battery-outline",
  "battery.25percent": "battery-20",
  "battery.50percent": "battery-50",
  "battery.75percent": "battery-70",
  "battery.100percent": "battery",
  "battery.100percent.bolt": "battery-charging",
  "minus.plus.batteryblock": "car-battery",
  bolt: "flash-outline",
  "bolt.car": "car-electric-outline",
  "ev.charger": "ev-station",
  "ev.plug.ac.type.2": "ev-plug-type2",
  fuelpump: "gas-station-outline",
  power: "power",
  "poweroutlet.strip": "power-socket",
  "poweroutlet.type.a": "power-socket-us",
  "poweroutlet.type.b": "power-socket-us",
  "poweroutlet.type.c": "power-socket-eu",
  "poweroutlet.type.d": "power-socket",
  "poweroutlet.type.e": "power-socket-fr",
  "poweroutlet.type.f": "power-socket-de",
  "poweroutlet.type.g": "power-socket-uk",
  "poweroutlet.type.h": "power-socket",
  "poweroutlet.type.i": "power-socket-au",
  "poweroutlet.type.j": "power-socket-ch",
  "poweroutlet.type.k": "power-socket",
  "poweroutlet.type.l": "power-socket-it",
  "poweroutlet.type.m": "power-socket",
  "poweroutlet.type.n": "power-socket-ch",
  "poweroutlet.type.o": "power-socket",
  powerplug: "power-plug-outline",
  "sun.max": "weather-sunny",
  "sun.min": "weather-sunny",
  "sun.max.trianglebadge.exclamationmark": "weather-sunny-alert",

  // doors, windows and covers
  "blinds.horizontal.closed": "blinds-horizontal-closed",
  "blinds.horizontal.open": "blinds-horizontal",
  "blinds.vertical.closed": "blinds-vertical-closed",
  "blinds.vertical.open": "blinds-vertical",
  "curtains.closed": "curtains-closed",
  "curtains.open": "curtains",
  "door.french.closed": "door-closed",
  "door.french.open": "door-open",
  "door.garage.closed": "garage",
  "door.garage.open": "garage-open",
  "door.garage.double.bay.closed": "garage-variant",
  "door.garage.double.bay.open": "garage-open-variant",
  "door.left.hand.closed": "door-closed",
  "door.left.hand.open": "door-open",
  "door.right.hand.closed": "door-closed",
  "door.right.hand.open": "door-open",
  "door.sliding.left.hand.closed": "door-sliding",
  "door.sliding.left.hand.open": "door-sliding-open",
  "door.sliding.right.hand.closed": "door-sliding",
  "door.sliding.right.hand.open": "door-sliding-open",
  "pedestrian.gate.closed": "gate",
  "pedestrian.gate.open": "gate-open",
  "roller.shade.closed": "roller-shade-closed",
  "roller.shade.open": "roller-shade",
  "roman.shade.closed": "roller-shade-closed",
  "roman.shade.open": "roller-shade",
  "window.awning": "window-open-variant",
  "window.awning.closed": "window-closed-variant",
  "window.casement": "window-open",
  "window.casement.closed": "window-closed",
  "window.ceiling": "window-open-variant",
  "window.ceiling.closed": "window-closed-variant",
  "window.horizontal": "window-open",
  "window.horizontal.closed": "window-closed",
  "window.shade.closed": "window-shutter",
  "window.shade.open": "window-shutter-open",
  "window.vertical.closed": "window-closed-variant",
  "window.vertical.open": "window-open-variant",

  // security and presence
  alarm: "alarm",
  bell: "bell-outline",
  camera: "camera-outline",
  "contact.sensor": "door-open",
  "entry.lever.keypad": "lock-smart",
  eye: "eye-outline",
  "figure.run": "run",
  "figure.walk": "walk",
  "figure.walk.arrival": "location-enter",
  "figure.walk.departure": "location-exit",
  house: "home-outline",
  key: "key-outline",
  lock: "lock-outline",
  "lock.open": "lock-open-outline",
  person: "account-outline",
  "person.2": "account-multiple-outline",
  "person.3": "account-group-outline",
  sensor: "motion-sensor",
  shield: "shield-outline",
  video: "video-outline",
  "video.doorbell": "doorbell-video",
  "web.camera": "webcam",

  // appliances and rooms
  bathtub: "bathtub-outline",
  "bed.double": "bed-double-outline",
  cabinet: "cupboard-outline",
  chair: "chair-school",
  "chair.lounge": "sofa-single-outline",
  cooktop: "stove",
  "cup.and.saucer": "coffee-outline",
  dishwasher: "dishwasher",
  dryer: "tumble-dryer",
  "fork.knife": "silverware-fork-knife",
  "frying.pan": "pan",
  microwave: "microwave",
  oven: "stove",
  refrigerator: "fridge-outline",
  "robotic.vacuum": "robot-vacuum",
  "robotic.vacuum.and.arrowtriangle.up": "robot-vacuum",
  "robotic.vacuum.and.ellipsis": "robot-vacuum",
  sofa: "sofa-outline",
  "square.split.bottomrightquarter": "floor-plan",
  stairs: "stairs",
  stove: "stove",
  "table.furniture": "table-furniture",
  toilet: "toilet",
  trash: "trash-can-outline",
  washer: "washing-machine",

  // water
  drop: "water-outline",
  "drop.keypad.rectangle": "water-sync",
  "pipe.and.drop": "pipe-leak",
  shower: "shower-head",
  "shower.handheld": "shower-head",
  "shower.sidejet": "shower",
  sink: "countertop-outline",
  spigot: "faucet",
  sprinkler: "sprinkler",
  "sprinkler.and.droplets": "sprinkler-variant",
  "water.waves": "waves",

  // media and network
  "antenna.radiowaves.left.and.right": "access-point",
  "dot.radiowaves.left.and.right": "access-point",
  "av.remote": "remote",
  desktopcomputer: "monitor",
  gamecontroller: "controller-classic-outline",
  headphones: "headphones",
  hifireceiver: "audio-video",
  hifispeaker: "speaker",
  homepod: "speaker",
  iphone: "cellphone",
  laptopcomputer: "laptop",
  "music.note": "music-note",
  network: "web",
  pause: "pause",
  play: "play-outline",
  printer: "printer-outline",
  "server.rack": "server",
  speaker: "volume-medium",
  "speaker.wave.2": "volume-high",
  stop: "stop",
  tv: "television",
  videoprojector: "projector",
  wifi: "wifi",
  "wifi.router": "router-wireless",

  // weather and nature
  cloud: "cloud-outline",
  "cloud.rain": "weather-rainy",
  "cloud.sun": "weather-partly-cloudy",
  leaf: "leaf",
  moon: "weather-night",
  "moon.stars": "weather-night",
  pawprint: "paw-outline",
  sparkles: "creation-outline",
  "sun.horizon": "weather-sunset",
  tree: "tree-outline",
  wind: "weather-windy",

  // getting around
  airplane: "airplane",
  bicycle: "bicycle",
  bus: "bus",
  car: "car-outline",
  location: "navigation-outline",
  mappin: "map-marker-outline",
  tram: "tram",

  // money, time and the rest
  "arrow.up.arrow.down": "swap-vertical",
  balloon: "balloon",
  "balloon.2": "balloon",
  banknote: "cash",
  calendar: "calendar-month-outline",
  cart: "cart-outline",
  "chart.bar": "chart-bar",
  "chart.line.uptrend.xyaxis": "chart-line",
  "chart.pie": "chart-pie-outline",
  checkmark: "check",
  "checkmark.circle": "check-circle-outline",
  clock: "clock-outline",
  creditcard: "credit-card-outline",
  envelope: "email-outline",
  "exclamationmark.triangle": "alert-outline",
  "gauge.with.needle": "gauge",
  gear: "cog-outline",
  heart: "heart-outline",
  hourglass: "timer-sand",
  "info.circle": "information-outline",
  "party.popper": "party-popper",
  popcorn: "popcorn",
  // The activities' default symbol, a ring of ticks.
  "progress.indicator": "dots-circle",
  ring: "circle-outline",
  "ring.dashed": "dots-circle",
  shippingbox: "package-variant-closed",
  star: "star-outline",
  timer: "timer-outline",
  wrench: "wrench-outline",
  xmark: "close",
  "xmark.circle": "close-circle-outline",
};

/** The struck-through icon for a `.slash` symbol, where MDI has one. */
const OFF: Readonly<Record<string, string>> = {
  bell: "bell-off-outline",
  bolt: "flash-off-outline",
  camera: "camera-off-outline",
  car: "car-off",
  cloud: "cloud-off-outline",
  drop: "water-off-outline",
  eye: "eye-off-outline",
  fan: "fan-off",
  flame: "fire-off",
  lightbulb: "lightbulb-off-outline",
  lock: "lock-off-outline",
  "music.note": "music-note-off",
  person: "account-off-outline",
  shield: "shield-off-outline",
  speaker: "volume-off",
  video: "video-off-outline",
  wifi: "wifi-off",
};

/** Suffixes that restyle a symbol without changing what it depicts. */
const MODIFIERS: ReadonlySet<string> = new Set([
  "fill",
  "slash",
  "circle",
  "square",
  "rectangle",
  "inverse",
]);

/** The MDI name (no `mdi:` prefix) standing in for an SF Symbol, or null
 * when nothing is close. A name outside the table falls back to its base:
 * the restyling suffixes (`.fill`, `.circle`, `.square`, `.slash`…) and
 * anything from a `.badge` on are dropped. `.fill` picks the filled icon
 * over the outline, `.slash` the struck-through one where there is one. */
export function mdiFor(symbol: string): string | null {
  let parts = symbol.trim().toLowerCase().split(".");
  const fill = parts.includes("fill");
  const slash = parts.includes("slash");
  for (;;) {
    const name = parts.join(".");
    if (Object.hasOwn(MDI, name)) {
      const icon = (slash && Object.hasOwn(OFF, name) ? OFF[name] : MDI[name]) ?? "";
      return fill ? icon.replace(/-outline$/, "") : icon;
    }
    const badge = parts.findIndex((p, i) => i > 0 && p.endsWith("badge"));
    if (badge > 0) parts = parts.slice(0, badge);
    else if (parts.length > 1 && MODIFIERS.has(parts[parts.length - 1] ?? ""))
      parts = parts.slice(0, -1);
    else return null;
  }
}

/** The tables, for the test that checks every name against MDI. */
export const SYMBOL_ICON_TABLES = { MDI, OFF } as const;
