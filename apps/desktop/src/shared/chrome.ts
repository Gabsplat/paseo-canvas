// The window's own chrome on macOS: no title bar, the traffic lights drawn over the app's top-left corner.

/**
 * Where macOS draws the traffic lights (`trafficLightPosition`, from the window's top-left). They sit on the row of
 * the panel's top islands: the islands are 12 from the top and 44 tall, so the lights (about 14 tall) are centred on 34.
 */
export const TRAFFIC_LIGHTS = { x: 18, y: 27 } as const;
/** The room they take inside the panel: the top row starts after `left`, the left edge after `top`. */
export const TRAFFIC_LIGHT_INSET = { left: 78, top: 52 } as const;
/** Main → renderer: the window entered (true) or left (false) full screen, where macOS hides the lights. */
export const FULL_SCREEN_CHANNEL = 'lienzo:full-screen';
