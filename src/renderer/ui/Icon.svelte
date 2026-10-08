<script lang="ts" module>
  // Simple 24×24 line icons.
  const PATHS = {
    plus: ['M12 5v14', 'M5 12h14'],
    undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
    redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
    eraser: [
      'm7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21',
      'M22 21H7',
      'm5 11 9 9',
    ],
    settings: ['M20 7h-9', 'M14 17H5', 'M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
    trash: ['M3 6h18', 'M8 6V4h8v2', 'm19 6-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
    close: ['M18 6 6 18', 'm6 6 12 12'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    chevron: ['m9 18 6-6-6-6'],
    notebook: [
      'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
    ],
    board: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', 'm7 15 3-4 3 3 4-6'],
    pencil: ['M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
    move: ['M5 9l-3 3 3 3', 'M2 12h20', 'M19 9l3 3-3 3'],
    folder: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  } as const;

  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 24 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each PATHS[name] as d (d)}
    <path {d} />
  {/each}
</svg>
