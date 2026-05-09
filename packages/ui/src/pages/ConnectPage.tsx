import { useEffect, useState } from "react";

const COMMAND = "claude mcp add compile -- npx @compile/mcp";

export function ConnectPage(): JSX.Element {
  const [typed, setTyped] = useState("");
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    setTyped("");
    setResolved(false);
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(COMMAND.length, i + 2);
      setTyped(COMMAND.slice(0, i));
      if (i >= COMMAND.length) {
        clearInterval(id);
        setTimeout(() => setResolved(true), 700);
      }
    }, 50);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="connect-terminal">
      <div>
        <span className="prompt">$ </span>
        <span className="typed">{typed}</span>
        {!resolved && <span className="caret" />}
      </div>
      {resolved ? (
        <div className="resolved">
          ✓ compile registered · acme/agent · ready
        </div>
      ) : null}
    </div>
  );
}
