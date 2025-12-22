import React from 'react';
import { render } from 'ink';
import { App, AppProps } from './App.js';

export function runUi(opts: AppProps) {
  return render(<App {...opts} />);
}
