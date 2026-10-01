import { upcomingRuns } from "@/lib/coffeerun/run";

export const dynamic = "force-dynamic";

/** Ближайшие кофе-раны из расписания. Запись идёт через лендинг забега. */
export async function GET() {
  const runs = upcomingRuns().slice(0, 3).map((r) => ({
    spot: r.spot,
    spotName: r.spotName,
    date: r.date,
    dateLabel: r.dateLabel,
    weekday: r.weekday,
    gatherTime: r.gatherTime,
    startTime: r.startTime,
    address: r.address,
    distance: r.distance,
    landing: r.landing,
    mapUrl: r.mapUrl,
  }));
  return Response.json({ runs }, { headers: { "Cache-Control": "public, max-age=300" } });
}
