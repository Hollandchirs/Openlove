import { NextResponse } from "next/server";
import { readConfig } from "../../../lib/config";

export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json(config);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read configuration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
