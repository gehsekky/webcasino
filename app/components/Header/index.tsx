type HeaderProps = {
  title: string;
};

const Header = ({ title } : HeaderProps) => {
  return (
    <h1 className="text-5xl">{title}</h1>
  );
};

export default Header;
