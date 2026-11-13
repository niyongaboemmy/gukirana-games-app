"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { stageNav, useStage, viewForPath } from "./stage";

const SceneCanvas = dynamic(() => import("./SceneCanvas"), { ssr: false, loading: () => null });

/**
 * Root-layout host of the persistent 3D stage (P1-WLD-05). Pages no longer own a <Canvas>: the route only says
 * which view is on screen (/gate, /world, /room/<game>; anything else hides and pauses the canvas while the areas
 * stay warm). Walking through a door switches the view first and updates the URL after, so the picture never
 * waits for the router. Behind the canvas a CSS morning sky shows until the first 3D frame (never a blank page).
 */
export function SceneHost() {
  const path = usePathname();
  const router = useRouter();
  const pathView = viewForPath(path);
  const [on, setOn] = useState(false);
  const view = useStage((s) => s.view);

  useEffect(() => {
    stageNav.push = (href) => router.push(href);
    stageNav.replace = (href) => router.replace(href);
  }, [router]);

  // the route decides the view on deep links, reloads and back / forward (a crossing has already set it)
  useEffect(() => {
    if (pathView) setOn(true);
    if (useStage.getState().view !== pathView) useStage.getState().show(pathView);
  }, [pathView]);

  if (!on) return null;
  return (
    <div aria-hidden={!view} className="fixed inset-0 z-0" style={{ visibility: view ? "visible" : "hidden" }}>
      <div className="gk-sky absolute inset-0" />
      <div className="absolute inset-0">
        <SceneCanvas />
      </div>
    </div>
  );
}
