const appScreens = [...document.querySelectorAll(".app-screen")];
const mainNavigation = document.querySelector(".navigation");
const mobileMenuToggle = document.querySelector(".menu-toggle");
const journalEntry = document.querySelector("#journal-entry");
const journalStatus = document.querySelector("#journal-status");
const journalCounter = document.querySelector("#journal-counter");
const settingsStatus = document.querySelector("#settings-status");
const largeTextToggle = document.querySelector("#large-text-toggle");
const highContrastToggle = document.querySelector("#high-contrast-toggle");
const themeToggle = document.querySelector("#theme-toggle");
const languageSelect = document.querySelector("#language-select");
const translationCatalog = globalThis.MIND_CARE_TRANSLATION_CATALOG;
const chatApiBaseUrl = globalThis.MIND_CARE_APP_CONFIG?.chatApiBaseUrl || "";
const JOURNAL_STORAGE_KEY = "mind-care-journal-v1";
const LARGE_TEXT_STORAGE_KEY = "mind-care-large-text-v1";
const HIGH_CONTRAST_STORAGE_KEY = "mind-care-high-contrast-v1";
const THEME_STORAGE_KEY = "mind-care-theme-v1";
const LANGUAGE_STORAGE_KEY = "mind-care-language-v1";
const OBSOLETE_CREATOR_STORAGE_KEY = "mind-care-creator-v1";
const NEEDS_RESPONSES = translationCatalog.needsResponses;
const URGENT_CHAT_RESPONSE = translationCatalog.urgentChatResponse;
const EXTRA_TRANSLATION_TEXTS = [
  ...translationCatalog.extraTexts,
  ...Object.values(NEEDS_RESPONSES),
  URGENT_CHAT_RESPONSE
];
let selectedLanguage = "en";
let currentTranslations = Object.create(null);
let activeScreen;

function localized(text, replacements = {}) {
  let output = currentTranslations[text] || text;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${key}}}`, String(value));
  }
  return output;
}

function setThemePreference(theme) {
  updateThemeToggle(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    settingsStatus.textContent = localized("Your display choice is saved in this browser.");
  } catch (error) {
    console.error("[preferences] Theme setting could not be saved:", error.name);
    settingsStatus.textContent = localized("This browser blocked saving preferences. The setting is active for this visit only.");
  }
}

function updateJournalCounter() {
  journalCounter.textContent = localized("{{COUNT}}/5000 characters", { COUNT: journalEntry.value.length });
}

function updateThemeToggle(theme) {
  const isDark = theme === "dark";
  document.body.dataset.theme = theme;
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", localized(isDark ? "Switch to light mode" : "Switch to dark mode"));
  themeToggle.querySelector(".theme-icon").textContent = isDark ? "☀" : "☾";
  themeToggle.querySelector(".theme-label").textContent = localized(isDark ? "Light mode" : "Dark mode");
  document.querySelector('meta[name="theme-color"]').content = isDark ? "#171925" : "#fbf8ef";
}

function loadSavedPreferences() {
  try {
    const largeTextEnabled = localStorage.getItem(LARGE_TEXT_STORAGE_KEY) === "true";
    const highContrastEnabled = localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === "true";
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    document.body.dataset.largeText = String(largeTextEnabled);
    document.body.dataset.highContrast = String(highContrastEnabled);
    largeTextToggle.setAttribute("aria-pressed", String(largeTextEnabled));
    highContrastToggle.setAttribute("aria-pressed", String(highContrastEnabled));
    updateThemeToggle(savedTheme === "dark" ? "dark" : "light");
    const savedJournalEntry = localStorage.getItem(JOURNAL_STORAGE_KEY);
    if (savedJournalEntry !== null) {
      journalEntry.value = savedJournalEntry;
      journalStatus.textContent = localized("Your saved note is loaded from this browser. Delete it whenever you like.");
    }
    updateJournalCounter();
  } catch (error) {
    console.error("[preferences] Browser storage could not be read:", error.name);
    journalStatus.textContent = localized("This browser blocked saved notes. You can still write here, but the note won’t persist.");
    settingsStatus.textContent = localized("This browser blocked saved preferences. Display settings can still be changed for this visit.");
    updateJournalCounter();
  }
}

function setDisplayPreference(toggle, storageKey, dataAttribute, enabled) {
  document.body.dataset[dataAttribute] = String(enabled);
  toggle.setAttribute("aria-pressed", String(enabled));

  try {
    localStorage.setItem(storageKey, String(enabled));
    settingsStatus.textContent = localized("Your display choice is saved in this browser.");
  } catch (error) {
    console.error("[preferences] Display setting could not be saved:", error.name);
    settingsStatus.textContent = localized("This browser blocked saving preferences. The setting is active for this visit only.");
  }
}

function findScreenFromHash(hash) {
  const targetId = decodeURIComponent(hash.replace(/^#/, ""));
  const target = targetId ? document.getElementById(targetId) : null;
  return target?.closest(".app-screen") || document.querySelector('[data-screen="home"]');
}

function setActiveScreen(screen, moveFocus = false) {
  if (!screen) return;
  activeScreen = screen;

  appScreens.forEach((item) => {
    const isActive = item === screen;
    item.hidden = !isActive;
    item.classList.toggle("is-active", isActive);
  });

  mainNavigation.querySelectorAll('a[href^="#"]').forEach((link) => {
    const target = document.querySelector(link.getAttribute("href"));
    link.removeAttribute("aria-current");
    if (target?.closest(".app-screen") === screen) link.setAttribute("aria-current", "page");
  });

  mobileMenuToggle.setAttribute("aria-expanded", "false");
  mobileMenuToggle.querySelector(".sr-only").textContent = localized("Open navigation menu");
  mainNavigation.classList.remove("is-open");
  window.scrollTo({ top: 0, behavior: "auto" });

  if (moveFocus) {
    const heading = screen.querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }
}

appScreens.forEach((screen) => {
  const controls = document.createElement("div");
  controls.className = "screen-controls";
  const topicsLink = document.createElement("a");
  topicsLink.href = "#topics";
  topicsLink.className = "screen-back-link";
  topicsLink.textContent = localized(screen.dataset.screen === "home" ? "Explore topics →" : "← All topics");
  controls.append(topicsLink);

  if (screen.dataset.screen !== "home") {
    const homeLink = document.createElement("a");
    homeLink.href = "#home";
    homeLink.className = "screen-home-link";
    homeLink.setAttribute("aria-label", localized("Back to home"));
    homeLink.textContent = localized("⌂ Home");
    controls.append(homeLink);
  }

  screen.prepend(controls);
});

document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const destination = link.getAttribute("href");
  if (destination === "#main") return;
  const destinationScreen = findScreenFromHash(destination);
  if (!destinationScreen) return;

  event.preventDefault();
  const target = document.querySelector(destination);
  if (destinationScreen === activeScreen && target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  history.pushState(null, "", destination);
  setActiveScreen(destinationScreen, true);
});

window.addEventListener("popstate", () => {
  setActiveScreen(findScreenFromHash(location.hash), true);
});

setActiveScreen(findScreenFromHash(location.hash));
loadSavedPreferences();

journalEntry.addEventListener("input", updateJournalCounter);

document.querySelector("#journal-save").addEventListener("click", () => {
  const content = journalEntry.value.trim();
  if (!content) {
    journalStatus.textContent = localized("Write a note first. Empty notes aren’t saved.");
    journalEntry.focus();
    return;
  }

  try {
    localStorage.setItem(JOURNAL_STORAGE_KEY, content);
    journalStatus.textContent = localized("Your note is saved in this browser on this device. Remember to delete it if this device is shared.");
  } catch (error) {
    console.error("[journal] The note could not be saved:", error.name);
    journalStatus.textContent = localized("Your browser couldn’t save this note. You can copy it somewhere private before leaving this page.");
  }
});

document.querySelector("#journal-clear").addEventListener("click", () => {
  try {
    localStorage.removeItem(JOURNAL_STORAGE_KEY);
    journalEntry.value = "";
    updateJournalCounter();
    journalStatus.textContent = localized("Your saved note has been deleted from this browser.");
  } catch (error) {
    console.error("[journal] The saved note could not be deleted:", error.name);
    journalStatus.textContent = localized("Your browser couldn’t delete the saved note. Try clearing this site’s data in your browser settings.");
  }
});

largeTextToggle.addEventListener("click", () => {
  const enabled = largeTextToggle.getAttribute("aria-pressed") !== "true";
  setDisplayPreference(largeTextToggle, LARGE_TEXT_STORAGE_KEY, "largeText", enabled);
});

highContrastToggle.addEventListener("click", () => {
  const enabled = highContrastToggle.getAttribute("aria-pressed") !== "true";
  setDisplayPreference(highContrastToggle, HIGH_CONTRAST_STORAGE_KEY, "highContrast", enabled);
});

themeToggle.addEventListener("click", () => {
  setThemePreference(document.body.dataset.theme === "dark" ? "light" : "dark");
});

const moodResponses = {
  overwhelmed: "That sounds like a lot to carry. You could choose just one small thing to focus on right now.",
  anxious: "It can be hard when your mind feels busy. Try noticing one thing around you that feels steady.",
  low: "You don’t have to force yourself to feel differently. A little rest or reaching out may be enough for now.",
  okay: "I’m glad there’s a little room to breathe. You can take this moment at your own pace."
};

const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatLog = document.querySelector("#chat-log");
const chatStatus = document.querySelector("#chat-status");
const chatSend = chatForm.querySelector(".chat-send");
const chatHistory = [];

function addChatMessage(role, text, typing = false) {
  const message = document.createElement("article");
  message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}${typing ? " chat-typing" : ""}`;

  if (role === "assistant") {
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "✿";
    message.append(avatar);
  }

  const content = document.createElement("p");
  content.textContent = text;
  message.append(content);
  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
  return message;
}

async function sendChatMessage(text) {
  const message = text.trim();
  if (chatSend.disabled) return;
  if (!message) {
    chatStatus.textContent = localized("Write a message first, or choose one of the suggestions.");
    chatInput.focus();
    return;
  }

  addChatMessage("user", message);
  chatInput.value = "";
  chatInput.style.height = "";
  chatSend.disabled = true;
  chatForm.setAttribute("aria-busy", "true");
  chatStatus.textContent = localized("Getting a reply. If this feels urgent, use the support links below instead.");
  const typingMessage = addChatMessage("assistant", localized("Thinking of a helpful reply…"), true);
  const recentHistory = chatHistory.slice(-10);

  try {
    const response = await fetch(`${chatApiBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: selectedLanguage, messages: [...recentHistory, { role: "user", content: message }] })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "The chat couldn’t reply just now. Please try again later.");
    }

    typingMessage.remove();
    addChatMessage("assistant", result.urgent ? localized(result.reply) : result.reply);
    chatHistory.push({ role: "user", content: message }, { role: "assistant", content: result.reply });
    if (chatHistory.length > 12) chatHistory.splice(0, chatHistory.length - 12);
    chatStatus.textContent = localized("Replies are AI-generated and can be wrong. Don’t share identifying details.");
  } catch (error) {
    typingMessage.remove();
    addChatMessage("assistant", error.message || "The chat couldn’t reply just now. Please try again later.");
    chatStatus.textContent = localized("Your message wasn’t saved by this page. You can still use the tools or support links below.");
  } finally {
    chatSend.disabled = false;
    chatForm.removeAttribute("aria-busy");
    chatInput.focus();
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChatMessage(chatInput.value);
});

chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 100)}px`;
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

document.querySelectorAll(".prompt-chip").forEach((button) => {
  button.addEventListener("click", () => {
    chatInput.value = button.textContent;
    chatForm.requestSubmit();
  });
});

chatForm.addEventListener("input", (event) => {
  if (event.target === chatInput && chatInput.value.length > 1500) {
    chatStatus.textContent = `${2000 - chatInput.value.length} characters remaining. Avoid sharing identifying details.`;
  } else if (event.target === chatInput) {
    chatStatus.textContent = localized("Please don’t share passwords, addresses, or other identifying details.");
  }
});

const moodButtons = document.querySelectorAll(".mood-option");
const moodResponse = document.querySelector("#mood-response");

moodButtons.forEach((button) => {
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    moodButtons.forEach((option) => option.setAttribute("aria-pressed", "false"));
    button.setAttribute("aria-pressed", "true");
    moodResponse.textContent = localized(moodResponses[button.dataset.mood]);
  });
});

const taskInput = document.querySelector("#task-input");
const taskButton = document.querySelector("#task-button");
const taskResponse = document.querySelector("#task-response");

taskButton.addEventListener("click", () => {
  const task = taskInput.value.trim();

  if (!task) {
    taskResponse.textContent = localized("Add one thing on your mind first, or leave it blank and take a breath.");
    taskInput.focus();
    return;
  }

  taskResponse.textContent = localized("For “{{TASK}}”, what is one step you could do in five minutes? You can start there—or ask someone to help.", { TASK: task });
});

const sleepButton = document.querySelector("#sleep-button");
const sleepTips = [...document.querySelectorAll(".sleep-tip input")];
const sleepResponse = document.querySelector("#sleep-response");

sleepButton.addEventListener("click", () => {
  const nextTip = sleepTips.find((tip) => !tip.checked);

  if (!nextTip) {
    sleepResponse.textContent = localized("You’ve picked the ideas that feel right for tonight. There’s no need to do them all.");
    return;
  }

  nextTip.checked = true;
  const tipName = nextTip.closest(".sleep-tip").querySelector("strong").textContent;
  sleepResponse.textContent = localized("A gentle place to start: {{TIP}}. It’s okay to keep it simple.", { TIP: tipName.toLowerCase() });
});

mobileMenuToggle.addEventListener("click", () => {
  const isOpen = mobileMenuToggle.getAttribute("aria-expanded") === "true";
  mobileMenuToggle.setAttribute("aria-expanded", String(!isOpen));
  mobileMenuToggle.querySelector(".sr-only").textContent = localized(isOpen ? "Open navigation menu" : "Close navigation menu");
  mainNavigation.classList.toggle("is-open", !isOpen);
});

const breathButton = document.querySelector("#breath-button");
const breathingCircle = document.querySelector("#breathing-circle");
const breathLabel = document.querySelector("#breath-label");
const breathInstruction = document.querySelector("#breath-instruction");
let breathingInterval;
let breathPhase = 0;
const breathPhases = ["Breathe in", "Breathe out"];

function setBreathButtonLabel(label) {
  const icon = breathButton.querySelector("[aria-hidden='true']");
  breathButton.replaceChildren(document.createTextNode(`${label} `), icon);
}

breathButton.addEventListener("click", () => {
  const isBreathing = breathingCircle.classList.contains("is-breathing");

  if (isBreathing) {
    window.clearInterval(breathingInterval);
    breathingCircle.classList.remove("is-breathing");
    breathLabel.textContent = localized("Ready?");
    breathInstruction.textContent = localized("A simple breathing pause");
    setBreathButtonLabel(localized("Begin breathing"));
    return;
  }

  breathPhase = 0;
  breathingCircle.classList.add("is-breathing");
  breathLabel.textContent = localized(breathPhases[breathPhase]);
  breathInstruction.textContent = localized("Follow the circle, at your own pace");
  setBreathButtonLabel(localized("Pause breathing"));
  breathingInterval = window.setInterval(() => {
    breathPhase = (breathPhase + 1) % breathPhases.length;
    breathLabel.textContent = localized(breathPhases[breathPhase]);
  }, 4000);
});

const MOOD_HISTORY_KEY = "mind-care-mood-history-v1";
const PLANNER_KEY = "mind-care-planner-v1";
const CONTACTS_KEY = "mind-care-contacts-v1";
const FEEDBACK_KEY = "mind-care-feedback-v1";
function readLocalArray(key, statusNode) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new TypeError("Saved data is not a list.");
    return value;
  } catch (error) {
    console.error(`[storage] Saved data could not be read for ${key}:`, error.name);
    if (statusNode?.dataset) statusNode.dataset.storageError = "Saved information could not be read in this browser.";
    return [];
  }
}

function saveLocalValue(key, value, statusNode, successMessage, errorMessage) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (statusNode?.dataset) delete statusNode.dataset.storageError;
    if (statusNode) statusNode.textContent = localized(successMessage);
    return true;
  } catch (error) {
    console.error(`[storage] Saved data could not be written for ${key}:`, error.name);
    if (statusNode) statusNode.textContent = localized(errorMessage);
    return false;
  }
}

function renderMoodHistory() {
  const list = document.querySelector("#mood-history-list");
  const historyItems = readLocalArray(MOOD_HISTORY_KEY, list);
  list.replaceChildren();
  if (list.dataset.storageError) {
    const error = document.createElement("li");
    error.className = "list-empty";
    error.textContent = localized(list.dataset.storageError);
    list.append(error);
    return;
  }
  if (!historyItems.length) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = localized("No mood check-ins yet.");
    list.append(empty);
    return;
  }
  historyItems.slice().reverse().forEach((item) => {
    const row = document.createElement("li");
    const label = moodButtons.length ? [...moodButtons].find((button) => button.dataset.mood === item.mood)?.querySelector("span:last-child")?.textContent : "";
    const details = document.createElement("span");
    details.textContent = `${label || item.mood} · ${new Date(item.at).toLocaleString()}`;
    row.append(details);
    list.append(row);
  });
}

moodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const historyItems = readLocalArray(MOOD_HISTORY_KEY, document.querySelector("#mood-history-list"));
    historyItems.push({ mood: button.dataset.mood, at: new Date().toISOString() });
    if (historyItems.length > 30) historyItems.splice(0, historyItems.length - 30);
    if (saveLocalValue(MOOD_HISTORY_KEY, historyItems, document.querySelector("#mood-history-list"),
      "Your mood check-in was saved in this browser.", "Your browser couldn’t save this mood check-in.")) {
      renderMoodHistory();
    }
  });
});

document.querySelector("#mood-history-clear").addEventListener("click", () => {
  try {
    localStorage.removeItem(MOOD_HISTORY_KEY);
    renderMoodHistory();
  } catch (error) {
    console.error("[mood-history] History could not be cleared:", error.name);
    const list = document.querySelector("#mood-history-list");
    list.dataset.storageError = "Saved information could not be read in this browser.";
    renderMoodHistory();
  }
});

function renderPlanner() {
  const list = document.querySelector("#plan-list");
  const tasks = readLocalArray(PLANNER_KEY, list);
  list.replaceChildren();
  if (list.dataset.storageError) {
    const error = document.createElement("li");
    error.className = "list-empty";
    error.textContent = localized(list.dataset.storageError);
    list.append(error);
    return;
  }
  if (!tasks.length) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = localized("No planned steps yet.");
    list.append(empty);
    return;
  }
  tasks.forEach((task) => {
    const row = document.createElement("li");
    const details = document.createElement("span");
    details.textContent = `${task.text}${task.deadline ? ` · ${task.deadline}` : ""}`;
    if (task.done) details.className = "list-complete";
    const actions = document.createElement("span");
    const doneButton = document.createElement("button");
    doneButton.type = "button";
    doneButton.textContent = localized(task.done ? "Mark not done" : "Mark done");
    doneButton.addEventListener("click", () => {
      task.done = !task.done;
      saveLocalValue(PLANNER_KEY, tasks, list, "Your step was saved in this browser.", "Your browser couldn’t save this plan. Please check the browser’s storage settings.");
      renderPlanner();
    });
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = localized("Remove");
    removeButton.addEventListener("click", () => {
      const remaining = tasks.filter((entry) => entry.id !== task.id);
      if (saveLocalValue(PLANNER_KEY, remaining, list, "Your step was saved in this browser.", "Your browser couldn’t save this plan. Please check the browser’s storage settings.")) renderPlanner();
    });
    actions.append(doneButton, removeButton);
    row.append(details, actions);
    list.append(row);
  });
}

document.querySelector("#plan-add").addEventListener("click", () => {
  const text = taskInput.value.trim();
  if (!text) {
    taskResponse.textContent = localized("Enter one small step before adding it to your plan.");
    taskInput.focus();
    return;
  }
  const tasks = readLocalArray(PLANNER_KEY, document.querySelector("#plan-list"));
  tasks.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text,
    deadline: document.querySelector("#plan-deadline").value,
    done: false
  });
  if (saveLocalValue(PLANNER_KEY, tasks, taskResponse, "Your step was saved in this browser.", "Your browser couldn’t save this plan. Please check the browser’s storage settings.")) {
    taskInput.value = "";
    document.querySelector("#plan-deadline").value = "";
    renderPlanner();
  }
});

document.querySelectorAll(".calming-button").forEach((button) => {
  button.addEventListener("click", () => {
    const response = button.closest(".calming-card").querySelector(".calming-response");
    const isBodyPause = button.closest(".calming-card").querySelector("h3").textContent === localized("A gentle body pause");
    response.textContent = localized(isBodyPause
      ? "A gentle body pause can be helpful. Notice a point of support and let your shoulders rest if that feels okay."
      : "You might notice one sound close by, then one farther away. You can stop whenever you like.");
  });
});

document.querySelectorAll(".needs-option").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".needs-option").forEach((option) => option.setAttribute("aria-pressed", "false"));
    button.setAttribute("aria-pressed", "true");
    document.querySelector("#needs-response").textContent = localized(NEEDS_RESPONSES[button.dataset.need]);
  });
});

function safeContactLink(value) {
  if (/^[+()\d.\-\s]{5,}$/.test(value) && value.replace(/\D/g, "").length >= 5) return `tel:${value.replace(/[^\d+]/g, "")}`;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.href;
  } catch {
    return null;
  }
  return null;
}

function renderContacts() {
  const list = document.querySelector("#contact-list");
  const contacts = readLocalArray(CONTACTS_KEY, list);
  list.replaceChildren();
  if (list.dataset.storageError) {
    const error = document.createElement("li");
    error.className = "list-empty";
    error.textContent = localized(list.dataset.storageError);
    list.append(error);
    return;
  }
  if (!contacts.length) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = localized("No trusted contacts added yet.");
    list.append(empty);
    return;
  }
  contacts.forEach((contact) => {
    const row = document.createElement("li");
    const details = document.createElement("span");
    details.textContent = `${contact.name}: `;
    const linkTarget = safeContactLink(contact.value);
    if (linkTarget) {
      const link = document.createElement("a");
      link.href = linkTarget;
      link.textContent = contact.value;
      if (linkTarget.startsWith("http")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      details.append(link);
    } else {
      details.append(document.createTextNode(contact.value));
    }
    const actions = document.createElement("span");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = localized("Remove");
    removeButton.addEventListener("click", () => {
      const remaining = contacts.filter((entry) => entry.id !== contact.id);
      if (saveLocalValue(CONTACTS_KEY, remaining, list, "Your contact was removed.", "Your browser couldn’t update this contact.")) renderContacts();
    });
    actions.append(removeButton);
    row.append(details, actions);
    list.append(row);
  });
}

document.querySelector("#contact-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.querySelector("#contact-name").value.trim();
  const value = document.querySelector("#contact-phone").value.trim();
  if (!name || !value) return;
  const list = document.querySelector("#contact-list");
  const contacts = readLocalArray(CONTACTS_KEY, list);
  contacts.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, value });
  if (saveLocalValue(CONTACTS_KEY, contacts, list, "Your contact was saved in this browser.", "Your browser couldn’t save this contact. Please check the browser’s storage settings.")) {
    event.currentTarget.reset();
    renderContacts();
  }
});

function renderFeedback() {
  const list = document.querySelector("#feedback-list");
  const feedback = readLocalArray(FEEDBACK_KEY, list);
  list.replaceChildren();
  if (list.dataset.storageError) {
    const error = document.createElement("li");
    error.className = "list-empty";
    error.textContent = localized(list.dataset.storageError);
    list.append(error);
    return;
  }
  if (!feedback.length) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = localized("No feedback saved yet.");
    list.append(empty);
    return;
  }
  feedback.slice().reverse().forEach((item) => {
    const row = document.createElement("li");
    const message = document.createElement("span");
    message.textContent = item.text;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = localized("Remove feedback");
    removeButton.addEventListener("click", () => {
      const remaining = feedback.filter((entry) => entry.id !== item.id);
      if (saveLocalValue(FEEDBACK_KEY, remaining, list, "Your feedback was removed.", "Your browser couldn’t update feedback.")) renderFeedback();
    });
    row.append(message, removeButton);
    list.append(row);
  });
}

document.querySelector("#feedback-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#feedback-entry");
  const text = input.value.trim();
  if (!text) return;
  const list = document.querySelector("#feedback-list");
  const feedback = readLocalArray(FEEDBACK_KEY, list);
  feedback.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text });
  if (feedback.length > 20) feedback.splice(0, feedback.length - 20);
  if (saveLocalValue(FEEDBACK_KEY, feedback, document.querySelector("#feedback-form"),
    "Your feedback was saved in this browser.", "Your browser couldn’t save feedback. Please check the browser’s storage settings.")) {
    event.currentTarget.reset();
    renderFeedback();
  }
});

function isTranslatableTextNode(node) {
  const parent = node.parentElement;
  if (!parent || !node.nodeValue.trim()) return false;
  if (parent.closest(".language-control, [aria-hidden='true'], script, style, textarea, input, select, option")) return false;
  if (parent.closest("#contact-list, #plan-list, #mood-history-list, #feedback-list, .project-credits span")) return false;
  if (parent.closest("#mood-response, #task-response, #sleep-response, #needs-response, #chat-status, #journal-status, #journal-counter, #settings-status")) return false;
  const chatLog = parent.closest(".chat-log");
  return !chatLog || Boolean(parent.closest(".initial-chat-message"));
}

function collectTranslationRecords() {
  const textRecords = [];
  const attributeRecords = [];
  const sources = new Set(EXTRA_TRANSLATION_TEXTS);
  sources.add(document.title);
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta?.content) sources.add(descriptionMeta.content);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!isTranslatableTextNode(node)) continue;
    const source = node.nodeValue.trim();
    textRecords.push({ node, source, original: node.nodeValue });
    sources.add(source);
  }

  document.querySelectorAll("[placeholder], [aria-label], [title]").forEach((element) => {
    if (element.closest(".language-control, #contact-list, #plan-list, #mood-history-list, #feedback-list")) return;
    for (const attribute of ["placeholder", "aria-label", "title"]) {
      const source = element.getAttribute(attribute);
      if (source && source.trim()) {
        attributeRecords.push({ element, attribute, source, original: source });
        sources.add(source.trim());
      }
    }
  });
  return { textRecords, attributeRecords, sources: [...sources] };
}

const translationRecords = collectTranslationRecords();

function applyTranslations(translations, language) {
  currentTranslations = translations;
  selectedLanguage = language;
  document.documentElement.lang = language === "hinglish" ? "en-IN" : `${language}-IN`;
  document.title = localized("Mind Care — a student-made wellbeing space");
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) {
    descriptionMeta.content = localized("Mind Care is a student-made wellbeing dashboard for everyone, with a private mood check-in, supportive AI chat, calming tools, and helpline information.");
  }
  translationRecords.textRecords.forEach(({ node, source, original }) => {
    if (!node.isConnected) return;
    const whitespace = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
    node.nodeValue = `${whitespace[1]}${localized(source)}${whitespace[3]}`;
  });
  translationRecords.attributeRecords.forEach(({ element, attribute, source }) => {
    if (element.isConnected) element.setAttribute(attribute, localized(source.trim()));
  });
  languageSelect.value = language;
  updateThemeToggle(document.body.dataset.theme || "light");
  updateJournalCounter();
  moodResponse.textContent = localized("Whatever you’re feeling, it makes sense to pause and notice it.");
  taskResponse.textContent = localized("A first step can take just five minutes.");
  sleepResponse.textContent = localized("Choose a tip to get a simple place to start.");
  chatStatus.textContent = localized("Please don’t share passwords, addresses, or other identifying details.");
  document.querySelector("#needs-response").textContent = localized("Pick an option to see a gentle suggestion.");
  renderMoodHistory();
  renderPlanner();
  renderContacts();
  renderFeedback();
}

function validateTranslationMap(translations) {
  return translations && typeof translations === "object" && !Array.isArray(translations)
    && translationRecords.sources.every((source) => typeof translations[source] === "string" && translations[source].trim());
}

async function requestTranslations(language) {
  let response;
  try {
    response = await fetch(`/language-packs/${language}.json`);
  } catch (error) {
    console.error("[translation] The bundled language pack could not be fetched:", error.message);
    throw new Error(localized("This language pack is missing from this app. Rebuild or update the app, then try again."));
  }
  if (!response.ok) {
    throw new Error(localized("This language pack is missing from this app. Rebuild or update the app, then try again."));
  }

  let pack;
  try {
    pack = await response.json();
  } catch {
    throw new Error(localized("The installed language pack is unreadable. English remains available."));
  }
  if (pack.language === language && validateTranslationMap(pack.translations)) return pack.translations;
  throw new Error(localized("The installed language pack is incomplete. English remains available."));
}

async function setPageLanguage(language, previousLanguage) {
  if (language === "en") {
    applyTranslations(Object.create(null), "en");
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
      document.querySelector("#language-status").textContent = "";
    } catch (error) {
      console.error("[translation] Language preference could not be saved:", error.name);
      document.querySelector("#language-status").textContent = localized("The translated page may be imperfect. Use the official support details for urgent needs.");
    }
    return;
  }

  languageSelect.disabled = true;
  languageSelect.setAttribute("aria-busy", "true");
  document.querySelector("#language-status").textContent = localized("Loading the language pack…");
  try {
    const translations = await requestTranslations(language);
    applyTranslations(translations, language);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (error) {
      console.error("[translation] Language preference could not be saved:", error.name);
    }
    document.querySelector("#language-status").textContent = localized("The translated page may be imperfect. Use the official support details for urgent needs.");
  } catch (error) {
    console.error("[translation] The page could not be translated:", error.message);
    applyTranslations(currentTranslations, previousLanguage);
    languageSelect.value = previousLanguage;
    document.querySelector("#language-status").textContent = error.message || localized("The translation could not be completed. English remains available.");
  } finally {
    languageSelect.disabled = false;
    languageSelect.removeAttribute("aria-busy");
  }
}

languageSelect.addEventListener("change", () => {
  const previousLanguage = selectedLanguage;
  setPageLanguage(languageSelect.value, previousLanguage);
});

renderMoodHistory();
renderPlanner();
renderContacts();
renderFeedback();

try {
  localStorage.removeItem(OBSOLETE_CREATOR_STORAGE_KEY);
} catch (error) {
  console.error("[storage] Legacy creator details could not be removed:", error.name);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch((error) => {
    console.error("[offline] The app shell could not be cached:", error.message);
  });
}

try {
  const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (savedLanguage && [...languageSelect.options].some((option) => option.value === savedLanguage)) {
    if (savedLanguage !== "en") setPageLanguage(savedLanguage, "en");
  }
} catch (error) {
  console.error("[translation] Saved language could not be read:", error.name);
}
