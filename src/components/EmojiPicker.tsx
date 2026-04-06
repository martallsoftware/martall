import { useState, useRef, useEffect } from "react";

const EMOJI_CATEGORIES: { name: string; emojis: string[] }[] = [
  {
    name: "Smileys",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊",
      "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋",
      "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🫡",
      "🤐", "🤨", "😐", "😑", "😶", "🫥", "😏", "😒", "🙄", "😬",
      "😮‍💨", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕",
      "🤢", "🤮", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸",
      "😎", "🤓", "🧐", "😕", "🫤", "😟", "🙁", "😮", "😯", "😲",
      "😳", "🥺", "🥹", "😦", "😧", "😨", "😰", "😥", "😢", "😭",
      "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡",
      "😠", "🤬", "😈", "👿", "💀", "☠️", "💩", "🤡", "👹", "👺",
    ],
  },
  {
    name: "Hands",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "🫱", "🫲", "🫳", "🫴", "🫷",
      "🫸", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙",
      "👈", "👉", "👆", "🖕", "👇", "☝️", "🫵", "👍", "👎", "✊",
      "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏",
      "✍️", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "👀",
    ],
  },
  {
    name: "Hearts",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
      "💟", "♥️", "🫶", "💑", "💏", "👩‍❤️‍👨", "💐", "🌹", "🥀", "🌷",
    ],
  },
  {
    name: "Nature",
    emojis: [
      "🌞", "🌝", "🌛", "🌜", "🌚", "🌙", "⭐", "🌟", "✨", "⚡",
      "🔥", "💥", "☀️", "🌤️", "⛅", "🌥️", "🌦️", "🌧️", "⛈️", "🌩️",
      "❄️", "☃️", "⛄", "🌊", "💧", "💦", "🌈", "🌸", "💮", "🌺",
      "🌻", "🌼", "🌱", "🪴", "🌲", "🌳", "🌴", "🌵", "🍀", "🍁",
      "🍂", "🍃", "🍄", "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻",
    ],
  },
  {
    name: "Food",
    emojis: [
      "🍎", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒",
      "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🍆", "🌶️", "🫑",
      "🥕", "🧅", "🧄", "🥔", "🍞", "🥐", "🥖", "🧀", "🍖", "🍗",
      "🥩", "🌭", "🍔", "🍟", "🍕", "🌮", "🌯", "🥗", "🍝", "🍜",
      "🍲", "🍛", "🍣", "🍱", "🥟", "🍩", "🍪", "🎂", "🍰", "☕",
    ],
  },
  {
    name: "Objects",
    emojis: [
      "📝", "📒", "📓", "📔", "📕", "📖", "📗", "📘", "📙", "📚",
      "📰", "📎", "📌", "📍", "✂️", "🖊️", "🖋️", "✒️", "📏", "📐",
      "💻", "🖥️", "🖨️", "⌨️", "🖱️", "💾", "💿", "📷", "📹", "🎥",
      "📱", "📞", "☎️", "📟", "📠", "🔋", "🔌", "💡", "🔦", "🕯️",
      "🔑", "🗝️", "🔒", "🔓", "🛠️", "⚙️", "🔧", "🔨", "⛏️", "🪛",
    ],
  },
  {
    name: "Symbols",
    emojis: [
      "✅", "❌", "❓", "❗", "‼️", "⁉️", "💯", "🔴", "🟠", "🟡",
      "🟢", "🔵", "🟣", "⚫", "⚪", "🟤", "🔶", "🔷", "🔸", "🔹",
      "▶️", "⏸️", "⏹️", "⏺️", "⏭️", "⏮️", "⏩", "⏪", "🔀", "🔁",
      "🔂", "➕", "➖", "➗", "✖️", "♻️", "💲", "💱", "©️", "®️",
      "™️", "🏁", "🚩", "🎌", "🏴", "🏳️", "⚠️", "🚫", "🔞", "📵",
    ],
  },
  {
    name: "Flags",
    emojis: [
      "🇺🇸", "🇬🇧", "🇫🇷", "🇩🇪", "🇮🇹", "🇪🇸", "🇵🇹", "🇳🇱", "🇧🇪", "🇨🇭",
      "🇦🇹", "🇸🇪", "🇳🇴", "🇩🇰", "🇫🇮", "🇮🇸", "🇮🇪", "🇵🇱", "🇨🇿", "🇷🇴",
      "🇭🇺", "🇬🇷", "🇹🇷", "🇷🇺", "🇺🇦", "🇯🇵", "🇨🇳", "🇰🇷", "🇮🇳", "🇧🇷",
      "🇦🇺", "🇨🇦", "🇲🇽", "🇦🇷", "🇿🇦", "🇪🇬", "🇳🇬", "🇰🇪", "🇸🇦", "🇦🇪",
    ],
  },
];

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  // Flatten all emojis for search (just filter by category name since we don't have emoji names)
  const displayedEmojis = search
    ? EMOJI_CATEGORIES.flatMap((c) => c.emojis)
    : EMOJI_CATEGORIES[activeCategory].emojis;

  return (
    <div
      ref={ref}
      className="absolute bottom-10 right-0 z-50 w-[340px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e2e] shadow-2xl flex flex-col"
      style={{ maxHeight: "380px" }}
    >
      {/* Search */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search emojis..."
          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-[#16162a] focus:outline-none focus:ring-1 focus:ring-accent/50"
        />
      </div>

      {/* Category tabs */}
      {!search && (
        <div className="flex gap-0.5 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(i)}
              className={`px-2 py-1 text-[10px] rounded-md whitespace-nowrap transition-colors ${
                activeCategory === i
                  ? "bg-accent/15 text-accent font-medium"
                  : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-8 gap-0.5">
          {displayedEmojis.map((emoji, i) => (
            <button
              key={`${emoji}-${i}`}
              onClick={() => onSelect(emoji)}
              className="w-9 h-9 flex items-center justify-center text-xl rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
