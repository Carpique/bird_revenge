import Matter from 'matter-js';

export const { Engine, Bodies, Body, Common, Composite, Constraint, Events, Query, Vertices } = Matter;
export type MBody = Matter.Body;
export type MConstraint = Matter.Constraint;
export type MEngine = Matter.Engine;
export type MPair = Matter.Pair;

/** Fixed physics step (ms). */
export const STEP_MS = 1000 / 60;

/** Matter.js forces are in mass·px/ms²; convert from an acceleration in px/s². */
export const forceFor = (body: MBody, accelPxPerS2: number) => (body.mass * accelPxPerS2) / 1e6;

/** Bodies in this group never collide with each other (bird and its poo). */
export const BIRD_GROUP = -1;
