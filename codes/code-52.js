<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ألعاب عشوائية 🎮</title>

<style>
* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: linear-gradient(135deg, #15152f, #27275a);
  color: white;
  text-align: center;
  min-height: 100vh;
}

header { padding: 35px 15px 20px; }

h1 { font-size: 35px; margin-bottom: 10px; }
p { color: #d3d3ee; }

button {
  border: none;
  border-radius: 12px;
  padding: 12px 18px;
  margin: 5px;
  font-size: 16px;
  cursor: pointer;
  background: #7657ff;
  color: white;
  transition: .2s;
}

button:hover {
  transform: translateY(-2px);
  background: #947cff;
}

.random-btn {
  background: #ffbd4a;
  color: #222;
  font-weight: bold;
  padding: 15px 25px;
  font-size: 18px;
}

.games {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
  padding: 20px;
  max-width: 1100px;
  margin: auto;
}

.card {
  background: #ffffff12;
  border: 1px solid #ffffff20;
  border-radius: 20px;
  padding: 25px 15px;
  cursor: pointer;
  transition: .2s;
}

.card:hover {
  background: #ffffff22;
  transform: translateY(-5px);
}

.emoji { font-size: 45px; }

#gameArea {
  display: none;
  background: #ffffff12;
  border: 1px solid #ffffff25;
  border-radius: 20px;
  max-width: 600px;
  margin: 20px auto;
  padding: 25px 15px;
  min-height: 240px;
}

input {
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-size: 17px;
  width: 130px;
  text-align: center;
}

#result {
  margin: 20px 0;
  font-size: 19px;
  font-weight: bold;
}

footer {
  padding: 25px;
  color: #aaaad0;
}
</style>
</head>

<body>

<header>
  <h1>🎮 عالم الألعاب</h1>
  <p>اختر لعبة واستمتع بوقتك!</p>
  <button class="random-btn" onclick="randomGame()">
    🎲 اختر لعبة عشوائية
  </button>
</header>

<div class="games" id="gamesList">

  <div class="card" onclick="startGame(0)">
    <div class="emoji">🔢</div>
    <h3>خمن الرقم</h3>
    <p>اكتشف الرقم السري من 1 إلى 100</p>
  </div>

  <div class="card" onclick="startGame(1)">
    <div class="emoji">✊</div>
    <h3>حجر ورقة مقص</h3>
    <p>تحدَّ الكمبيوتر واربح!</p>
  </div>

  <div class="card" onclick="startGame(2)">
    <div class="emoji">⚡</div>
    <h3>تحدي السرعة</h3>
    <p>اضغط أكبر عدد ممكن خلال 10 ثوانٍ</p>
  </div>

  <div class="card" onclick="startGame(3)">
    <div class="emoji">🧠</div>
    <h3>لعبة الذاكرة</h3>
    <p>اعثر على الأزواج المتطابقة</p>
  </div>

  <div class="card" onclick="startGame(4)">
    <div class="emoji">➕</div>
    <h3>تحدي الحساب</h3>
    <p>حل المسائل قبل نفاد الوقت</p>
  </div>

</div>

<section id="gameArea">
  <h2 id="gameTitle"></h2>
  <div id="gameContent"></div>
  <div id="result"></div>
  <button onclick="showMenu()">🏠 قائمة الألعاب</button>
</section>

<script>
const names = [
  "🔢 خمن الرقم",
  "✊ حجر ورقة مقص",
  "⚡ تحدي السرعة",
  "🧠 لعبة الذاكرة",
  "➕ تحدي الحساب"
];

let secret, attempts, clicks, seconds, timer;
let score = 0;
let locked = false;
let matched = 0;

function showMenu() {
  clearInterval(timer);
  document.getElementById("gameArea").style.display = "none";
  document.getElementById("gamesList").style.display = "grid";
  document.getElementById("result").textContent = "";
}

function randomGame() {
  startGame(Math.floor(Math.random() * 5));
}

function startGame(id) {
  clearInterval(timer);
  document.getElementById("gamesList").style.display = "none";
  document.getElementById("gameArea").style.display = "block";
  document.getElementById("gameTitle").textContent = names[id];
  document.getElementById("gameContent").innerHTML = "";
  document.getElementById("result").textContent = "";

  if (id === 0) numberGame();
  if (id === 1) rpsGame();
  if (id === 2) speedGame();
  if (id === 3) memoryGame();
  if (id === 4) mathGame();
}

// اللعبة الأولى: تخمين الرقم
function numberGame() {
  secret = Math.floor(Math.random() * 100) + 1;
  attempts = 0;

  document.getElementById("gameContent").innerHTML = `
    <p>اختر رقمًا بين 1 و100</p>
    <input id="guess" type="number" min="1" max="100"
      placeholder="رقمك">
    <button onclick="checkGuess()">تحقق</button>
  `;
}

function checkGuess() {
  const input = document.getElementById("guess");
  const n = Number(input.value);
  if (!input.value || n < 1 || n > 100 || !Number.isInteger(n)) {
    document.getElementById("result").textContent =
      "أدخل رقمًا صحيحًا من 1 إلى 100";
    return;
  }

  attempts++;
  if (n === secret) {
    document.getElementById("result").textContent =
      `🎉 أحسنت! وجدت الرقم في ${attempts} محاولة`;
  } else {
    document.getElementById("result").textContent =
      n < secret ? "⬆️ الرقم السري أكبر!" : "⬇️ الرقم السري أصغر!";
  }
}

// اللعبة الثانية: حجر ورقة مقص
function rpsGame() {
  document.getElementById("gameContent").innerHTML = `
    <p>اختر حركتك</p>
    <button onclick="playRPS('حجر')">✊ حجر</button>
    <button onclick="playRPS('ورقة')">✋ ورقة</button>
    <button onclick="playRPS('مقص')">✌️ مقص</button>
  `;
}

function playRPS(user) {
  const options = ["حجر", "ورقة", "مقص"];
  const cpu = options[Math.floor(Math.random() * 3)];
  let msg;

  if (user === cpu) {
    msg = "🤝 تعادل!";
  } else if (
    (user === "حجر" && cpu === "مقص") ||
    (user === "ورقة" && cpu === "حجر") ||
    (user === "مقص" && cpu === "ورقة")
  ) {
    msg = "🎉 لقد فزت!";
  } else {
    msg = "😅 الكمبيوتر فاز!";
  }

  document.getElementById("result").textContent =
    `أنت: ${user} | الكمبيوتر: ${cpu} — ${msg}`;
}

// اللعبة الثالثة: تحدي السرعة
function speedGame() {
  clicks = 0;
  seconds = 10;

  document.getElementById("gameContent").innerHTML = `
    <h3>الوقت: <span id="time">10</span> ثوانٍ</h3>
    <h2>النقرات: <span id="clickCount">0</span></h2>
    <button id="clickBtn" style="font-size:24px;padding:25px"
      onclick="addClick()">اضغط بسرعة! ⚡</button>
  `;

  document.getElementById("result").textContent = "هل تستطيع تحطيم الرقم القياسي؟";

  timer = setInterval(() => {
    seconds--;
    document.getElementById("time").textContent = seconds;

    if (seconds <= 0) {
      clearInterval(timer);
      document.getElementById("clickBtn").disabled = true;
      document.getElementById("result").textContent =
        `انتهى الوقت! نتيجتك ${clicks} نقرة 🎉`;
    }
  }, 1000);
}

function addClick() {
  clicks++;
  document.getElementById("clickCount").textContent = clicks;
}

// اللعبة الرابعة: الذاكرة
function memoryGame() {
  const emojis = ["🐱","🐶","🦊","🐸","🐼","🦁","🐱","🐶",
                  "🦊","🐸","🐼","🦁"];
  emojis.sort(() => Math.random() - 0.5);
  matched = 0;
  locked = false;

  document.getElementById("gameContent").innerHTML = `
    <p>اكشف البطاقات واعثر على كل زوج متطابق</p>
    <div id="board" style="
      display:grid;
      grid-template-columns:repeat(4,1fr);
      gap:8px;max-width:360px;margin:auto">
      ${emojis.map((e,i) => `
        <button id="card${i}" data-emoji="${e}"
          onclick="flipCard(${i})"
          style="font-size:27px;padding:15px 5px">❔</button>
      `).join("")}
    </div>
  `;

  window.memoryOpen = [];
  window.memoryFound = [];
}

function flipCard(i) {
  if (locked || window.memoryFound.includes(i) ||
      window.memoryOpen.includes(i)) return;

  const card = document.getElementById("card" + i);
  card.textContent = card.dataset.emoji;
  window.memoryOpen.push(i);

  if (window.memoryOpen.length === 2) {
    const [a,b] = window.memoryOpen;

    if (document.getElementById("card" + a).dataset.emoji ===
        document.getElementById("card" + b).dataset.emoji) {
      window.memoryFound.push(a,b);
      window.memoryOpen = [];
      matched += 2;

      if (matched === 12) {
        document.getElementById("result").textContent =
          "🏆 رائع! وجدت كل الأزواج!";
      }
    } else {
      locked = true;
      setTimeout(() => {
        document.getElementById("card" + a).textContent = "❔";
        document.getElementById("card" + b).textContent = "❔";
        window.memoryOpen = [];
        locked = false;
      }, 700);
    }
  }
}

// اللعبة الخامسة: الحساب
function mathGame() {
  score = 0;
  seconds = 30;

  document.getElementById("gameContent").innerHTML = `
    <h3>الوقت: <span id="mathTime">30</span> ثانية</h3>
    <h2 id="question"></h2>
    <input id="answer" type="number" placeholder="الإجابة">
    <button onclick="checkMath()">إجابة</button>
    <p>النقاط: <span id="points">0</span></p>
  `;

  nextQuestion();

  timer = setInterval(() => {
    seconds--;
    const el = document.getElementById("mathTime");
    if (el) el.textContent = seconds;

    if (seconds <= 0) {
      clearInterval(timer);
      document.getElementById("gameContent").innerHTML +=
        "<h3>انتهى التحدي!</h3>";
      document.getElementById("result").textContent =
        `🏆 نتيجتك النهائية: ${score} نقطة`;
    }
  }, 1000);
}

let correctAnswer = 0;

function nextQuestion() {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const op = Math.random() < 0.5 ? "+" : "-";

  correctAnswer = op === "+" ? a + b : a - b;
  document.getElementById("question").textContent =
    `${a} ${op} ${b} = ؟`;

  document.getElementById("answer").value = "";
  document.getElementById("answer").focus();
}

function checkMath() {
  if (seconds <= 0) return;

  const input = document.getElementById("answer");
  if (input.value.trim() === "") return;

  if (Number(input.value) === correctAnswer) {
    score++;
    document.getElementById("points").textContent = score;
    document.getElementById("result").textContent = "✅ إجابة صحيحة!";
  } else {
    document.getElementById("result").textContent = "❌ حاول مرة أخرى!";
  }

  nextQuestion();
}
</script>

<footer>
  🎮 ألعاب مجانية وممتعة — اختر لعبة وابدأ التحدي!
</footer>

</body>
</html>