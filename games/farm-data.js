// Little Furrow — static game data: crops, items, neighbors, journal goals.
// Everything here is original to Pixel Acre Arcade.

export const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
export const SEASON_COLORS = ["#86d9a6", "#f4d35e", "#f4a63a", "#a9c8ff"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAYS_PER_SEASON = 7;
export const HOUR_SECONDS = 20;            // real seconds per in-game hour
export const DAY_START = 6 * 60;           // 6:00 AM in minutes
export const PASS_OUT = 26 * 60;           // 2:00 AM next day

// shape: root | bush | tall | big | vine
export const CROPS = {
  turnip:     { name: "Turnip",      season: 0, days: 4,  regrow: 0, seed: 20,  sell: 60,  shape: "root", fruit: "#f3e9f7", top: "#b678d6", leaf: "#6cc46a" },
  potato:     { name: "Potato",      season: 0, days: 6,  regrow: 0, seed: 40,  sell: 110, shape: "root", fruit: "#c99a62", top: "#c99a62", leaf: "#4fa65a", flower: "#ffffff" },
  strawberry: { name: "Strawberry",  season: 0, days: 7,  regrow: 3, seed: 80,  sell: 90,  shape: "bush", fruit: "#e8414f", leaf: "#3f9a52" },
  tomato:     { name: "Tomato",      season: 1, days: 6,  regrow: 3, seed: 50,  sell: 70,  shape: "tall", fruit: "#e5482f", leaf: "#3e9a4a" },
  corn:       { name: "Corn",        season: 1, days: 8,  regrow: 3, seed: 70,  sell: 90,  shape: "tall", fruit: "#f6cf3c", leaf: "#7cbf4a", corn: true },
  melon:      { name: "Melon",       season: 1, days: 9,  regrow: 0, seed: 120, sell: 320, shape: "big",  fruit: "#7fbf5a", stripe: "#2f6b33", leaf: "#4c9a46" },
  pumpkin:    { name: "Pumpkin",     season: 2, days: 9,  regrow: 0, seed: 100, sell: 300, shape: "big",  fruit: "#ef8a2b", leaf: "#5a8f3a", ribbed: true },
  yam:        { name: "Sweet Potato",season: 2, days: 5,  regrow: 0, seed: 40,  sell: 100, shape: "root", fruit: "#a84f7a", top: "#a84f7a", leaf: "#6a9f44" },
  eggplant:   { name: "Eggplant",    season: 2, days: 6,  regrow: 3, seed: 50,  sell: 70,  shape: "bush", fruit: "#4b2a6b", leaf: "#4a8a4a", long: true },
  cabbage:    { name: "Frost Cabbage", season: 3, days: 6, regrow: 0, seed: 90, sell: 240, shape: "big", fruit: "#bfe3a8", leaf: "#8cc47a", leafy: true },
};

import { FISH } from "./farm/fishing.js";

// Inventory items. kind: seed | crop | produce | food | feed | fish | material
export const ITEMS = {};
for (const [id, c] of Object.entries(CROPS)) {
  ITEMS[id + "_seed"] = { name: c.name + " seeds", kind: "seed", crop: id, color: c.fruit, price: c.seed };
  ITEMS[id] = { name: c.name, kind: "crop", sell: c.sell, color: c.fruit, accent: c.leaf };
}
Object.assign(ITEMS, {
  egg:      { name: "Egg",         kind: "produce", sell: 50,  color: "#fff4e0", accent: "#e8d2b0" },
  gold_egg: { name: "Golden egg",  kind: "produce", sell: 160, color: "#f6cf3c", accent: "#d9a520" },
  milk:     { name: "Milk",        kind: "produce", sell: 110, color: "#ffffff", accent: "#8fb8ff" },
  fodder:   { name: "Fodder",      kind: "feed",    price: 10, color: "#d9b45a", accent: "#a8862f" },
  onigiri:  { name: "Rice ball",   kind: "food",    price: 60, color: "#ffffff", accent: "#2b3a2b", energy: 35 },
  tea:      { name: "Barley tea",  kind: "food",    price: 120, color: "#c98d4a", accent: "#7a4a1f", energy: 80 },
  wool:     { name: "Wool",        kind: "produce", sell: 140, color: "#f6f1e7", accent: "#c9bfa9" },
  wood:     { name: "Wood",        kind: "material", sell: 8,  color: "#b07a45", accent: "#6b4430" },
  stone:    { name: "Stone",       kind: "material", sell: 6,  color: "#a9a3b8", accent: "#6f6a80" },
});
for (const [id, f] of Object.entries(FISH)) ITEMS[id] = { name: f.name, kind: "fish", sell: f.sell, color: f.color, accent: f.accent };

export const UPGRADES = {
  can2:    { name: "Copper watering can", desc: "Holds 40 and waters 3 tiles in a row.", price: 1200, mats: { stone: 10 } },
  hoe2:    { name: "Copper hoe",          desc: "Tills 3 tiles in a row with one swing.", price: 1000, mats: { stone: 8 } },
  chicken: { name: "New hen",             desc: "One more hen for the coop (up to 6).",  price: 700, mats: { wood: 6 } },
  sheep:   { name: "New sheep",           desc: "One more sheep for the pasture (up to 4). Fed sheep grow wool every 2 days.", price: 1100, mats: { wood: 10 } },
  stamina: { name: "Comfy bedroll",       desc: "Raises your max energy by 20.",         price: 1500, mats: { wood: 12 } },
};

// Neighbors. Each line pairs the English text shown on screen with a short
// Japanese line that is voiced. pitch shapes the voice.
export const NPCS = {
  mina: {
    name: "Mina", role: "General store", color: "#f27c8c", hair: "#5a2e2a", shirt: "#f27c8c", pitch: 1.35,
    likes: ["strawberry", "melon", "egg", "gold_egg"], dislikes: ["eggplant"], shop: "store",
    greet: {
      morning: { en: "Morning! Fresh seeds just came in.", jp: "おはよう！" },
      day:     { en: "Welcome! Need anything for the field?", jp: "いらっしゃい！" },
      evening: { en: "Evening. Still working? You'll wear yourself out.", jp: "こんばんは！" },
    },
    chat: [
      { h: 0, en: "Turnips are the easiest start. Water them every day and they're ready in four.", jp: "カブは簡単だよ！" },
      { h: 0, en: "Rainy days water the whole field for you. Lucky!", jp: "雨の日はラッキーだね。" },
      { h: 0, en: "Have you met Grandpa Tomo by the pond? He can tell a crop's mood by its leaves.", jp: "トモじいちゃんに会った？" },
      { h: 1, en: "Summer melons sell for a small fortune. Plant them early!", jp: "夏のメロンは高いよ！" },
      { h: 2, en: "Strawberries keep fruiting after you pick them. That's my kind of plant.", jp: "イチゴ大好き！" },
      { h: 3, en: "The valley's been livelier since you moved in. I mean it.", jp: "ありがとうね。" },
      { h: 5, en: "I'm saving up for a little café one day. Don't tell anyone!", jp: "ひみつだよ！" },
    ],
    react: { like: { en: "For me? I love these!", jp: "わあ、うれしい！" }, ok: { en: "Thanks! That's kind of you.", jp: "ありがとう！" }, bad: { en: "Oh… um, thanks, I guess.", jp: "あ、ありがとう…" } },
    closed: { en: "The store's closed right now. Open 9 AM to 5 PM!", jp: "今はお休みだよ。" },
  },
  tomo: {
    name: "Tomo", role: "Retired farmer &amp; angler", color: "#8fb8ff", hair: "#d8d8d8", shirt: "#4f6d8f", pitch: 0.7,
    likes: ["potato", "yam", "pumpkin", "milk", "trout", "catfish"], dislikes: ["melon"], shop: null,
    greet: {
      morning: { en: "Mm. Early riser. Good.", jp: "おはよう。" },
      day:     { en: "The pond's calm today. Sit a while.", jp: "こんにちは。" },
      evening: { en: "The frogs are singing. Time to rest soon.", jp: "こんばんは。" },
    },
    chat: [
      { h: 0, en: "Soil remembers who cares for it. Water every morning.", jp: "土は覚えているよ。" },
      { h: 0, en: "Don't push yourself. A tired farmer drops seeds.", jp: "無理するなよ。" },
      { h: 0, en: "Weeds and stones on the field? Your hoe clears both.", jp: "クワを使いなさい。" },
      { h: 1, en: "Plant pumpkins on the first day of fall. They take their time.", jp: "カボチャはゆっくりだ。" },
      { h: 2, en: "The last farmer here grew the finest sweet potatoes in the valley.", jp: "なつかしいな。" },
      { h: 3, en: "You're catching up to them. Keep going.", jp: "なかなかやるな。" },
      { h: 5, en: "When I was young I wanted to be a sailor. Then I tasted my first tomato.", jp: "トマトが好きでな。" },
    ],
    react: { like: { en: "Ho! Now that's a proper crop.", jp: "これはいい！" }, ok: { en: "Thank you, young one.", jp: "ありがとう。" }, bad: { en: "Too sweet for these old teeth.", jp: "甘すぎるな…" } },
    closed: null,
  },
  kenji: {
    name: "Kenji", role: "Carpenter & tools", color: "#f4a63a", hair: "#2b1f1a", shirt: "#3f8f6a", pitch: 0.95,
    likes: ["corn", "tomato", "egg", "milk", "wood"], dislikes: ["turnip"], shop: "workshop",
    greet: {
      morning: { en: "Morning! The saw's sharp and so am I.", jp: "おはよう！" },
      day:     { en: "Hey, farmer! Here for an upgrade?", jp: "よう！" },
      evening: { en: "Last nail of the day. What's up?", jp: "おつかれ！" },
    },
    chat: [
      { h: 0, en: "Need sturdier tools? I can hammer something together.", jp: "道具なら任せて！" },
      { h: 0, en: "Hens love company. More hens, more eggs.", jp: "ニワトリはいいぞ！" },
      { h: 0, en: "A copper can waters three tiles at once. Your back will thank you.", jp: "腰にやさしいよ。" },
      { h: 1, en: "I'm building a new bench for the plaza. Sit on it when it's done!", jp: "完成したら座ってね。" },
      { h: 2, en: "Feed the animals at the trough every day. Happy animals give more.", jp: "毎日えさをあげてね。" },
      { h: 3, en: "You're the hardest worker in the valley. Second to me, of course.", jp: "負けないぞ！" },
      { h: 5, en: "Want to know a secret? I'm scared of chickens.", jp: "ニワトリこわい…" },
    ],
    react: { like: { en: "No way! My favorite!", jp: "最高！" }, ok: { en: "Appreciate it, friend.", jp: "サンキュー！" }, bad: { en: "Turnips… again? Ha. Thanks.", jp: "またカブか…" } },
    closed: { en: "Workshop's shut for the night. Open 10 AM to 6 PM.", jp: "今日は終わり！" },
  },
};

export const STORE_HOURS = { store: [9, 17], workshop: [10, 18] };

export const GOALS = [
  { id: "till",    text: "Till 5 tiles of soil",            need: 5,     stat: "tilled" },
  { id: "plant",   text: "Plant 5 seeds",                   need: 5,     stat: "planted" },
  { id: "water",   text: "Water 5 crops",                   need: 5,     stat: "watered" },
  { id: "ship",    text: "Ship your first harvest",         need: 1,     stat: "shipped" },
  { id: "egg",     text: "Collect an egg",                  need: 1,     stat: "eggs" },
  { id: "friend",  text: "Reach 2 hearts with a neighbor",  need: 2,     stat: "bestHearts" },
  { id: "earn1k",  text: "Earn 1,000 G in total",           need: 1000,  stat: "earned" },
  { id: "upgrade", text: "Buy something from Kenji",        need: 1,     stat: "upgrades" },
  { id: "big",     text: "Harvest a melon, pumpkin or cabbage", need: 1, stat: "bigHarvest" },
  { id: "wood",    text: "Chop 10 wood in Whisper Woods",   need: 10,    stat: "wood" },
  { id: "fish",    text: "Catch a fish",                    need: 1,     stat: "fish" },
  { id: "wool",    text: "Shear wool from a sheep",         need: 1,     stat: "wool" },
  { id: "earn10k", text: "Earn 10,000 G in total",          need: 10000, stat: "earned" },
];

// Tutorial hints shown in the hint strip until the matching goal is done.
export const HINTS = [
  { until: "till",  text: "Walk to the brown field, pick the Hoe (1) and press Space to till." },
  { until: "plant", text: "Pick Seeds (3) and press Space on tilled soil to plant." },
  { until: "water", text: "Pick the Can (2) and water your seeds. Refill at the well beside the field." },
  { until: null,    text: "Crops grow overnight when watered. Press E at your front door to sleep." },
];
