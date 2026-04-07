export type SidebarPanel = "home" | "notes" | "favorites" | "recent" | "tags" | "graph" | "search" | "vaults";

interface Props {
  active: SidebarPanel;
  onSelect: (panel: SidebarPanel) => void;
  onSettings: () => void;
}

const ITEMS: { id: SidebarPanel; label: string; icon: React.ReactNode }[] = [
  {
    id: "home",
    label: "Home",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8.5L10 3l7 5.5V16a1 1 0 01-1 1h-4v-4.5a1 1 0 00-1-1H9a1 1 0 00-1 1V17H4a1 1 0 01-1-1V8.5z" />
      </svg>
    ),
  },
  {
    id: "notes",
    label: "Notes",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="2" width="14" height="16" rx="2" />
        <path d="M7 6h6M7 10h6M7 14h3" />
      </svg>
    ),
  },
  {
    id: "favorites",
    label: "Favorites",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2l2.4 5 5.6.8-4 3.9 1 5.3L10 14l-5 2.9 1-5.3-4-3.9 5.6-.8z" />
      </svg>
    ),
  },
  {
    id: "recent",
    label: "Recent",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="8" />
        <path d="M10 5v5l3.5 2" />
      </svg>
    ),
  },
  {
    id: "tags",
    label: "Tags",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 10V3.5A1.5 1.5 0 013.5 2H10l8 8-6 6-8-8z" />
        <circle cx="6" cy="6" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "graph",
    label: "Graph",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="6" cy="5" r="2.5" />
        <circle cx="14" cy="5" r="2.5" />
        <circle cx="10" cy="15" r="2.5" />
        <path d="M7.8 7l2 5.5M12.2 7l-2 5.5" />
      </svg>
    ),
  },
  {
    id: "vaults",
    label: "Vaults",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="16" height="14" rx="2" />
        <path d="M2 7h16" />
        <circle cx="5" cy="5" r="0.5" fill="currentColor" />
        <circle cx="7.5" cy="5" r="0.5" fill="currentColor" />
        <path d="M6 11h8M6 14h5" />
      </svg>
    ),
  },
  {
    id: "search",
    label: "Search",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="M13 13l4.5 4.5" />
      </svg>
    ),
  },
];

export default function IconRail({ active, onSelect, onSettings }: Props) {
  return (
    <div className="flex flex-col items-center w-12 flex-shrink-0 border-r border-gray-200 dark:border-gray-700/50 bg-gray-100 dark:bg-[#16162a] py-2">
      {/* Logo */}
      <div className="mb-3 text-accent" title="Martall">
        <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {/* foliage clusters */}
          <circle cx="11" cy="9" r="4.2" fill="currentColor" fillOpacity="0.25" />
          <circle cx="17" cy="7.5" r="3.4" fill="currentColor" fillOpacity="0.25" />
          <circle cx="21" cy="11" r="3" fill="currentColor" fillOpacity="0.25" />
          {/* trunk */}
          <path d="M16 26c0-4 -3-6 -5-8c2 0 3 1 5 1c0-3 1-5 3-7" />
          {/* pot */}
          <path d="M10 26h12l-1.5 3h-9z" fill="currentColor" fillOpacity="0.2" />
        </svg>
      </div>

      {/* Nav items */}
      <div className="flex flex-col gap-1 flex-1">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`p-2 rounded-lg transition-colors ${
              active === item.id
                ? "bg-accent/15 text-accent"
                : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/50"
            }`}
            title={item.label}
          >
            {item.icon}
          </button>
        ))}
      </div>

      {/* Settings at bottom */}
      <button
        onClick={onSettings}
        className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700/50 transition-colors"
        title="Settings"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="3" />
          <path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.2 4.2l1.8 1.8M14 14l1.8 1.8M4.2 15.8l1.8-1.8M14 6l1.8-1.8" />
        </svg>
      </button>
    </div>
  );
}
