export function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-bubble rounded-bl-[6px] bg-surface-nika px-[18px] py-[14px]">
        {[0, 200, 400].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-ink-muted"
            style={{
              animation: "breathe 1.4s ease-in-out infinite",
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes breathe {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.85); }
          30% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
