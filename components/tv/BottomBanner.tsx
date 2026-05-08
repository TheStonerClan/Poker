type Props = {
  text: string;
};

export default function BottomBanner({ text }: Props) {
  return (
    <div className="w-full flex items-center justify-center py-3">
      <span className="text-label uppercase tracking-[0.35em] text-sm">
        {text}
      </span>
    </div>
  );
}
