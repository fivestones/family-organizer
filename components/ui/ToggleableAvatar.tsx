import React, { useState } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Toggle } from '@/components/ui/toggle';

const ToggleableAvatar = ({ name, isComplete, onToggle }) => {
  const initials = name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase();

  return (
    <Toggle
      pressed={isComplete}
      onPressedChange={onToggle}
      className="p-0 data-[state=on]:bg-transparent data-[state=off]:bg-transparent"
    >
      <div className={`rounded-full p-1 transition-colors duration-200 ${
        isComplete ? 'border-2 border-green-500' : 'border-2 border-amber-500'
      }`}>
        <Avatar className="h-8 w-8">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </div>
    </Toggle>
  );
};

export default ToggleableAvatar;