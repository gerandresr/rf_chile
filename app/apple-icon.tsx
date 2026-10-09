import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(ellipse at 50% 40%, #071122 0%, #0f1c39 70%, #173f83 100%)",
          border: "3px solid #79aaff",
          borderRadius: 37,
          color: "#ffffff",
          fontFamily: "Arial, sans-serif",
          fontWeight: 800,
          fontSize: 53,
          letterSpacing: -3,
        }}
      >
        RFCh
      </div>
    ),
    size,
  );
}
