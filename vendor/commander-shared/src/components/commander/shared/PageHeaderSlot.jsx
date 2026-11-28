/**
 * PageHeaderSlot - where the #SMARTERDESIGN page image header renders
 * (Dan, 2026-11-27: "CLUB COMMANDER NEEDS THE SAME #SMARTERDESIGN UPGRADE TO
 * EVERY SINGLE PAGE").
 *
 * CommanderLayout renders this directly below the global header and above the
 * page content. The consuming app provides the renderer through
 * PageHeaderSlotContext (Club Commander: pages/_app.js ->
 * src/components/commander/shared/CommanderImageHeader.jsx), so the artwork,
 * route registry and page help stay in the app while every page that uses
 * CommanderLayout gets the header without a per-page edit. With no provider
 * (any other consumer) it renders nothing.
 */
import { createContext, useContext } from 'react';

export const PageHeaderSlotContext = createContext(null);

export default function PageHeaderSlot({ title }) {
  const render = useContext(PageHeaderSlotContext);
  return typeof render === 'function' ? render({ title }) : null;
}
