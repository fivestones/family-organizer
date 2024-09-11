'use client'

import { useDroppable } from '@dnd-kit/core';
import React from 'react';

interface DroppableProps {
  id: string;
  children: React.ReactNode; // Add this line to define the children prop
}

const Droppable: React.FC<DroppableProps> = ({ id, children }) => {
  const { setNodeRef } = useDroppable({
    id,
  });

  const style = {
    width: 200,
    height: 200,
    border: '1px solid black',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children}
    </div>
  );
};

export default Droppable;