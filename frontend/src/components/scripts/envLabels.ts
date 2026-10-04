import type { ScriptEnvView } from '../../store/scriptSlice';

/** How each environment state of a Python script is shown on cards and in the Dependencias tab */
export const ENV_VIEW: Record<ScriptEnvView, { label: string; className: string; hint: string }> = {
  'sin-dependencias': {
    label: 'Sin dependencias',
    className: 'bg-bg text-muted border border-border',
    hint: 'No declara paquetes: corre en el entorno compartido.',
  },
  compartido: {
    label: 'Compartido',
    className: 'bg-success/10 text-success',
    hint: 'Sus paquetes están en el entorno compartido.',
  },
  propio: {
    label: 'Entorno propio',
    className: 'bg-accent-light text-accent',
    hint: 'Necesita versiones distintas de las del compartido, así que tiene su propio entorno.',
  },
  pendiente: {
    label: 'Falta preparar',
    className: 'bg-warn/15 text-fg',
    hint: 'Sus dependencias cambiaron o aún no se instalaron: se preparan al ejecutarlo.',
  },
  'no-preparado': {
    label: 'Python sin preparar',
    className: 'bg-danger/10 text-danger',
    hint: 'Prepara el entorno base arriba en Scripts.',
  },
  invalido: {
    label: 'Cabecera inválida',
    className: 'bg-danger/10 text-danger',
    hint: 'El bloque «# /// script» del archivo no es válido.',
  },
};
