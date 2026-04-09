import { useState } from "react";
import { useIDEStore } from "../store/useIDEStore";

const libs = [
  { name: "esp-hal", by: "esp-rs", ver: "0.18.0", desc: "Hardware abstraction layer para ESP32. Suporte GPIO, SPI, I2C, UART e mais.", installed: true },
  { name: "esp-backtrace", by: "esp-rs", ver: "0.13.0", desc: "Panic handler e backtrace para dispositivos ESP sem OS.", installed: true },
  { name: "esp-println", by: "esp-rs", ver: "0.10.0", desc: "Macro println! para ESP32 via UART ou RTT.", installed: false },
  { name: "embassy-executor", by: "embassy-rs", ver: "0.5.0", desc: "Executor async de alta performance para sistemas embarcados no_std.", installed: false },
  { name: "embassy-time", by: "embassy-rs", ver: "0.3.0", desc: "Primitivas de tempo async: Timer, Delay, Instant.", installed: false },
  { name: "heapless", by: "japaric", ver: "0.8.0", desc: "Estruturas de dados estáticas sem heap: Vec, String, Queue e mais.", installed: false },
  { name: "embedded-hal", by: "rust-embedded", ver: "1.0.0", desc: "Traits abstratas para drivers de hardware embarcado portáveis.", installed: false },
  { name: "smoltcp", by: "smoltcp-rs", ver: "0.11.0", desc: "Stack TCP/IP standalone para sistemas embarcados no_std.", installed: false },
];

export function LibraryManager() {
  const [filter, setFilter] = useState("");
  const [libState, setLibState] = useState(libs.map((l) => ({ ...l })));
  const [installing, setInstalling] = useState<string | null>(null);
  const { addLog } = useIDEStore();

  const filtered = libState.filter(
    (l) =>
      l.name.toLowerCase().includes(filter.toLowerCase()) ||
      l.desc.toLowerCase().includes(filter.toLowerCase())
  );

  const installLib = (idx: number) => {
    const lib = libState[idx];
    if (lib.installed || installing) return;
    setInstalling(lib.name);

    const delays: [number, string][] = [
      [0, `> cargo add ${lib.name}`],
      [500, `    Updating crates.io index`],
      [1200, `      Adding ${lib.name} v${lib.ver}`],
      [2000, `✓ ${lib.name} adicionado ao Cargo.toml`],
    ];
    delays.forEach(([ms, msg]) => {
      setTimeout(() => {
        addLog(msg);
        if (ms === 2000) {
          setLibState((prev) =>
            prev.map((l, i) => (i === idx ? { ...l, installed: true } : l))
          );
          setInstalling(null);
        }
      }, ms);
    });
  };

  return (
    <div className="lib-manager">

      {/* Search */}
      <div className="lib-search-wrap">
        <input
          id="lib-search"
          type="text"
          placeholder="Filtrar bibliotecas..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="lib-search"
          autoComplete="off"
        />
      </div>

      {/* Filters */}
      <div className="lib-filters">
        {["Type", "Topic"].map((label, i) => (
          <label key={label} className="lib-filter-label">
            {label}:
            <select className="lib-filter-select">
              {i === 0 ? (
                <><option>All</option><option>Installed</option></>
              ) : (
                <><option>All</option><option>GPIO</option><option>WiFi</option><option>I2C</option></>
              )}
            </select>
          </label>
        ))}
      </div>

      {/* Library List */}
      <div className="lib-list">
        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", textAlign: "center", color: "var(--ide-text-faint)", fontSize: 12 }}>
            Nenhuma biblioteca encontrada
          </div>
        )}
        {filtered.map((lib) => (
          <div key={lib.name} id={`lib-item-${lib.name}`} className="lib-item">
            <div className="lib-item-name">
              {lib.name}{" "}
              <span className="lib-item-author">by {lib.by}</span>
            </div>
            <div className="lib-item-desc">{lib.desc}</div>
            <span className="lib-item-more">More info</span>
            <div className="lib-item-actions">
              <select className="lib-version-select">
                <option>{lib.ver}</option>
              </select>
              {lib.installed ? (
                <button className="lib-btn lib-btn--installed">
                  ✓ INSTALLED
                </button>
              ) : (
                <button
                  id={`install-${lib.name}`}
                  onClick={() => installLib(libState.findIndex(l => l.name === lib.name))}
                  className="lib-btn lib-btn--install"
                  disabled={installing === lib.name}
                >
                  {installing === lib.name ? "Installing..." : "INSTALL"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
