"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
}

function Slider({ value, onValueChange, min, max, step = 1, disabled, className, id }: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("relative flex w-full items-center", className)}>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(Number(e.target.value))}
        className="slider-input h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${percentage}%, hsl(217 33% 17%) ${percentage}%, hsl(217 33% 17%) 100%)`,
        }}
      />
    </div>
  );
}

export { Slider };
