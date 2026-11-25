export const AREAS = [
  {
    name: "Greenvale",
    land: "River lowlands, farms and a bog",
    col: "#8cc06a",
    ink: "#3f6a2a",
  },
  {
    name: "Highcrag",
    land: "Mountain passes and old copper mines",
    col: "#b3ab9c",
    ink: "#5a5248",
  },
  {
    name: "Frostmere Reach",
    land: "Snowfields and a frozen lake",
    col: "#e4eef6",
    ink: "#5a7a9a",
  },
  {
    name: "Cinderwaste",
    land: "Ash plains, lava rivers, the King’s tomb",
    col: "#6a4a40",
    ink: "#2a1a14",
  },
];

// map: key of a built map in MAPS, or null while the level is still planned
export const LEVELS = [
  {
    id: "1-1",
    area: 0,
    name: "Millbrook Fields",
    map: "mill",
    x: 420,
    y: 805,
    story: "Goblin raiders are trampling the farms below the Keep, where the last beacon fire in the March still burns. Learn to build and drive them off.",
    tut: true,
  },
  {
    id: "1-2",
    area: 0,
    name: "River Crossing",
    map: "river",
    x: 322,
    y: 655,
    story: "The raiders reach the river, and cave bats fly straight over the water. Hold the bridge.",
  },
  {
    id: "1-3",
    area: 0,
    name: "Thornwood",
    map: "thorn",
    x: 150,
    y: 600,
    story: "The road leaves the river and plunges into the Thornwood, where goblin sappers lay their traps.",
  },
  {
    id: "1-4",
    area: 0,
    name: "Mire’s Edge",
    map: "mire",
    x: 262,
    y: 528,
    story: "Gruk the Mire-King wades out of the bog with his boar riders. End his raids for good.",
  },
  {
    id: "2-1",
    area: 1,
    name: "Highland Pass",
    map: "pass",
    x: 205,
    y: 395,
    story: "Knights who sold their oaths march with the horde up the switchbacks.",
  },
  {
    id: "2-2",
    area: 1,
    name: "Copperdeep Mines",
    map: null,
    x: 410,
    y: 300,
    story: "Cave trolls burrow through the old mines. Watch the tunnel mouths.",
  },
  {
    id: "2-3",
    area: 1,
    name: "Eagle’s Rest",
    map: null,
    x: 600,
    y: 165,
    story: "The Stone Warlord storms the cliff-top fortress.",
  },
  {
    id: "3-1",
    area: 2,
    name: "Frostmere",
    map: "frost",
    x: 905,
    y: 215,
    story: "Wraiths drift across the frozen lake, and arrows pass straight through them.",
  },
  {
    id: "3-2",
    area: 2,
    name: "Whitepine Hollow",
    map: null,
    x: 1200,
    y: 150,
    story: "A blizzard hides the Rime Matriarch’s march through the pines.",
  },
  {
    id: "4-1",
    area: 3,
    name: "Ember Crater",
    map: "crater",
    x: 1290,
    y: 470,
    story: "Every clan of the horde gathers in the ash fields.",
  },
  {
    id: "4-2",
    area: 3,
    name: "Obsidian Road",
    map: null,
    x: 1060,
    y: 640,
    story: "Lava surges across the road as the salamanders come.",
  },
  {
    id: "4-3",
    area: 3,
    name: "The Ashen Throne",
    map: null,
    x: 1400,
    y: 775,
    story: "The Ashen King wakes to snuff out the last light. End the march at his tomb.",
  },
];

// what the player has unlocked, by furthest level reached (Kingdom Rush style); Watch mode has everything
export const UNLOCKS = [
  {
    towers: ["arrow", "cannon", "frost"],
    max: 2,
    spec: false,
    note: "",
  },
  {
    towers: ["arrow", "cannon", "frost", "tesla"],
    max: 3,
    spec: false,
    note: "New tower: Tesla Coil. Every tower can now reach level 3.",
  },
  {
    towers: ["arrow", "cannon", "frost", "tesla", "flame"],
    max: 3,
    spec: true,
    note: "New tower: Flame Tower. Specialisations and their ranks are open.",
  },
  {
    towers: ["arrow", "cannon", "frost", "tesla", "flame", "barracks"],
    max: 3,
    spec: true,
    note: "New tower: Barracks. Its soldiers block the road and fight enemies hand to hand.",
  },
  {
    towers: ["arrow", "cannon", "frost", "tesla", "flame", "barracks", "drum"],
    max: 3,
    spec: true,
    note: "New tower: War Drum. The towers around it fire faster.",
  },
];

export const DIFFS = [
  {
    k: "casual",
    name: "Casual",
    mul: 1,
    dmg: 1,
    note: "Enemies at their base health and damage",
  },
  {
    k: "normal",
    name: "Normal",
    mul: 1.25,
    dmg: 1.25,
    note: "Enemies have 25% more health and deal 25% more damage",
  },
  {
    k: "impossible",
    name: "Impossible",
    mul: 1.5,
    dmg: 1.5,
    note: "Enemies have 50% more health and deal 50% more damage",
  },
];

export const BOUNTY = [0, 1, 3];
