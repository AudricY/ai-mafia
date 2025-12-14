import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

export function runUi(opts: { players: string[] }) {
  return render(<App players={opts.players} />);
}
