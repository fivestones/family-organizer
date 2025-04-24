// components/ui/ToggleableAvatar.tsx
import React from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Toggle } from '@/components/ui/toggle';


const ToggleableAvatar = ({ name, photoUrls, isComplete, onToggle }) => {
  console.log("name", name);
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  const photoUrl64 = photoUrls?.[64];

  return (
    <Toggle
      pressed={isComplete}
      onPressedChange={onToggle}
      className="p-0 data-[state=on]:bg-transparent data-[state=off]:bg-transparent"
    >
      <div
        className={`rounded-full p-1 transition-colors duration-200 ${
          isComplete ? 'border-2 border-green-500' : 'border-2 border-amber-500'
        }`}
      >
        <Avatar className="h-11 w-11">
          {photoUrl64 ? (
            <AvatarImage src={'uploads/' + photoUrl64} alt={name} />
          ) : (
            <AvatarFallback>{initials}</AvatarFallback>
          )}
        </Avatar>
      </div>
    </Toggle>
  );
};

export default ToggleableAvatar;