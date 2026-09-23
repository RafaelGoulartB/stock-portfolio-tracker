type BrandLogoProps = {
  className?: string;
};

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <img
      src="/portfolio-logo-64.png"
      alt=""
      width={64}
      height={64}
      className={className}
      aria-hidden="true"
    />
  );
}
