"use client";

import { useEffect, useMemo, useState } from "react";

type TPMMeetingsData = {
  dates: string[];
};

function formatMeetingDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}-${month}-${year}`;
}

export function TPMMeetings() {
  const [dates, setDates] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/data/tpm-meetings.json")
      .then((response) => response.json())
      .then((data: TPMMeetingsData) => setDates(Array.isArray(data.dates) ? data.dates : []))
      .catch(() => setDates([]));
  }, []);

  const futureDates = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return dates
      .filter((date) => {
        const [year, month, day] = date.split("-").map(Number);
        if (!year || !month || !day) return false;
        const meetingDate = new Date(year, month - 1, day);
        return meetingDate > today;
      })
      .sort((a, b) => a.localeCompare(b));
  }, [dates]);

  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          border: 0,
          padding: 0,
          background: "transparent",
          color: "inherit",
          font: "inherit",
          cursor: "pointer",
          fontWeight: 650,
        }}
      >
        Próximas Reuniones {open ? "▴" : "▾"}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {futureDates.length ? (
            <table style={{ width: "100%", minWidth: 0 }}>
              <thead>
                <tr><th style={{ textAlign: "left" }}>Fecha</th></tr>
              </thead>
              <tbody>
                {futureDates.map((date) => (
                  <tr key={date}><td style={{ textAlign: "left" }}>{formatMeetingDate(date)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <span className="muted">Sin reuniones futuras cargadas</span>
          )}
        </div>
      )}
    </div>
  );
}
