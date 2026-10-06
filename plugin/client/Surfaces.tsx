import React from 'react';
import { Platform, View } from 'react-native';
import { Txt } from './ui';
import { WebCanvasSurface, WebGLSurface, type CanvasSurfaceProps, type GLSurfaceProps } from './web';
export function NativeLearningFallback({ summary }: { summary: string }) {
  return <View style={{ gap: 4 }}><Txt>{summary}</Txt><Txt kind="small" muted>La versión interactiva está disponible en escritorio/web.</Txt></View>;
}
export function CanvasSurface(props: CanvasSurfaceProps & { summary: string }) {
  return Platform.OS === 'web' ? <WebCanvasSurface {...props} /> : <NativeLearningFallback summary={props.summary} />;
}
export function GLSurface(props: GLSurfaceProps & { summary: string }) {
  return Platform.OS === 'web' ? <WebGLSurface {...props} /> : <NativeLearningFallback summary={props.summary} />;
}
export type { CanvasSurfaceProps, GLSurfaceProps, Canvas2DContext, GLContext, SurfaceFrame, SurfacePointer } from './web';
export { compileGLProgram } from './web';
