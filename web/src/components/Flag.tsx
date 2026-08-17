type Code = "id" | "sg" | "my" | "th" | "ph" | "vn" | "asean" | "us" | "at" | "gb" | "il" | "in" | "cn";

export function Flag({ code, title }: { code: Code; title?: string }) {
  return (
    <span className="flag" title={title} aria-hidden>
      {code === "id" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="8" fill="#ce1126" />
          <rect y="8" width="24" height="8" fill="#fff" />
        </svg>
      )}
      {code === "sg" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="8" fill="#ef3340" />
          <rect y="8" width="24" height="8" fill="#fff" />
          <circle cx="6.2" cy="4" r="2.4" fill="#fff" />
          <circle cx="7.3" cy="4" r="2" fill="#ef3340" />
          <g fill="#fff">
            <circle cx="10.1" cy="2.2" r="0.45" />
            <circle cx="11.3" cy="3.1" r="0.45" />
            <circle cx="10.8" cy="4.6" r="0.45" />
            <circle cx="9.3" cy="4.6" r="0.45" />
            <circle cx="8.8" cy="3.1" r="0.45" />
          </g>
        </svg>
      )}
      {code === "my" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#fff" />
          {[0, 2, 4, 6, 8, 10, 12, 14].map((y) => (
            <rect key={y} y={y} width="24" height="1.14" fill="#cc0001" />
          ))}
          <rect width="12" height="8" fill="#010066" />
          <circle cx="7.2" cy="4" r="2.3" fill="#fc0" />
          <circle cx="8" cy="4" r="1.85" fill="#010066" />
          <polygon
            fill="#fc0"
            points="10.4,4 9.2,4.4 9.9,3.3 9.9,4.7 8.7,3.6"
          />
        </svg>
      )}
      {code === "th" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#a51931" />
          <rect y="2.7" width="24" height="10.6" fill="#fff" />
          <rect y="5.3" width="24" height="5.4" fill="#2d2a4a" />
        </svg>
      )}
      {code === "ph" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="8" fill="#0038a8" />
          <rect y="8" width="24" height="8" fill="#ce1126" />
          <polygon points="0,0 10,8 0,16" fill="#fff" />
          <circle cx="4.2" cy="8" r="1.15" fill="#fcd116" />
        </svg>
      )}
      {code === "vn" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#da251d" />
          <polygon
            fill="#ff0"
            points="12,3.2 13.1,6.6 16.8,6.6 13.8,8.7 15,12.2 12,10 9,12.2 10.2,8.7 7.2,6.6 10.9,6.6"
          />
        </svg>
      )}
      {code === "asean" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#0033a0" rx="1" />
          <circle cx="12" cy="8" r="5.2" fill="#fcd116" />
          <circle cx="12" cy="8" r="3.6" fill="#0033a0" />
          <circle cx="12" cy="8" r="1.3" fill="#fcd116" />
        </svg>
      )}
      {code === "us" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#fff" />
          {[0, 2.46, 4.92, 7.38, 9.84, 12.3, 14.76].map((y) => (
            <rect key={y} y={y} width="24" height="1.23" fill="#b22234" />
          ))}
          <rect width="10" height="8.6" fill="#3c3b6e" />
        </svg>
      )}
      {code === "at" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#ed2939" />
          <rect y="5.3" width="24" height="5.4" fill="#fff" />
        </svg>
      )}
      {code === "gb" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#012169" />
          <path d="M0 0 L24 16 M24 0 L0 16" stroke="#fff" strokeWidth="3.2" />
          <path d="M0 0 L24 16 M24 0 L0 16" stroke="#c8102e" strokeWidth="1.6" />
          <path d="M12 0 V16 M0 8 H24" stroke="#fff" strokeWidth="5" />
          <path d="M12 0 V16 M0 8 H24" stroke="#c8102e" strokeWidth="2.6" />
        </svg>
      )}
      {code === "il" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#fff" />
          <rect y="2" width="24" height="2" fill="#0038b8" />
          <rect y="12" width="24" height="2" fill="#0038b8" />
          <polygon points="12,4.6 14.4,8.8 9.6,8.8" fill="none" stroke="#0038b8" strokeWidth="0.7" />
          <polygon points="12,11.4 9.6,7.2 14.4,7.2" fill="none" stroke="#0038b8" strokeWidth="0.7" />
        </svg>
      )}
      {code === "in" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="5.33" fill="#ff9933" />
          <rect y="5.33" width="24" height="5.34" fill="#fff" />
          <rect y="10.67" width="24" height="5.33" fill="#138808" />
          <circle cx="12" cy="8" r="1.7" fill="none" stroke="#000080" strokeWidth="0.6" />
        </svg>
      )}
      {code === "cn" && (
        <svg viewBox="0 0 24 16">
          <rect width="24" height="16" fill="#de2910" />
          <polygon fill="#ffde00" points="4.2,3.2 4.7,4.7 6.3,4.7 5,5.6 5.5,7.1 4.2,6.2 2.9,7.1 3.4,5.6 2.1,4.7 3.7,4.7" />
        </svg>
      )}
    </span>
  );
}

const COUNTRY_FLAG: Record<string, Code> = {
  Indonesia: "id",
  Singapore: "sg",
  Malaysia: "my",
  Thailand: "th",
  Philippines: "ph",
  Vietnam: "vn",
  "United States": "us",
  USA: "us",
  China: "cn",
  India: "in",
  "United Kingdom": "gb",
  Austria: "at",
  Israel: "il",
};

export function flagForCountry(name?: string | null): Code | null {
  if (!name) return null;
  return COUNTRY_FLAG[name] || null;
}
